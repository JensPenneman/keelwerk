import type {
  BucketStore,
  Clock,
  ConsumerStore,
  EventStore,
  NamespaceRef,
  NestedUnitOptions,
  ReceiptStore,
  RowStore,
  ScopeKeyStore,
  SerialStore,
  StorageScope,
  StreamRecordStore,
  SubjectKeyStore,
  UsageStore,
} from '@keelwerk/core';
import type { Kysely } from 'kysely';
import { CompiledQuery } from 'kysely';
import { scopeSettingsStatement } from './postgres/scope-settings-statement.ts';
import { runSql } from './run-sql.ts';
import { scopeForbidden } from './scope-forbidden.ts';
import { sqlBucketStore } from './sql-bucket-store.ts';
import type { SqlCommitBuffer } from './sql-commit-buffer.ts';
import { sqlCommitBuffer } from './sql-commit-buffer.ts';
import { runCommitTail } from './sql-commit-tail.ts';
import { sqlConsumerStore } from './sql-consumer-store.ts';
import type { SqlDb } from './sql-db.ts';
import type { SqlEntityIndex } from './sql-entity-index.ts';
import { sqlEventStore } from './sql-event-store.ts';
import type { SqlJobStore } from './sql-job-store.ts';
import { sqlJobStore } from './sql-job-store.ts';
import type { SqlKeyWrapper } from './sql-key-wrapper.ts';
import { sqlReceiptStore } from './sql-receipt-store.ts';
import { sqlRowStore } from './sql-row-store.ts';
import { sqlScopeKeyStore } from './sql-scope-key-store.ts';
import { sqlSerialStore } from './sql-serial-store.ts';
import type { SqlSession } from './sql-session.ts';
import { sqlStreamRecordStore } from './sql-stream-record-store.ts';
import { sqlSubjectKeyStore } from './sql-subject-key-store.ts';
import type { SqlUnitContext } from './sql-unit-context.ts';
import { sqlUnitContext } from './sql-unit-context.ts';
import { sqlUsageStore } from './sql-usage-store.ts';

/** Thrown inside a read-only savepoint to roll it back, which also restores its settings. */
class EndReadOnlySavepoint extends Error {}

function sameScope(a: StorageScope, b: StorageScope): boolean {
  switch (a.level) {
    case 'tenant':
      return b.level === 'tenant' && b.tenantId === a.tenantId;
    case 'backend':
      return b.level === 'backend' && b.backendId === a.backendId;
    case 'deployment':
      return b.level === 'deployment';
    case 'namespace':
      return b.level === 'namespace';
  }
}

/**
 * The unit as far as the stores go that the SQL family implements (14.3.2): rows, the event store,
 * receipts, the job store (without `schedules()`, S-03), serials, usage, buckets and keys, plus the
 * scope keys of a deployment-scope unit (S-55).
 */
export interface SqlUnit {
  readonly namespace: NamespaceRef;
  readonly scope: StorageScope;
  readonly readOnly: boolean;
  /** Kysely over the unit's transaction, as the application role, without the scoping plugin. */
  readonly db: Kysely<SqlDb>;
  readonly rows: RowStore;
  readonly events: EventStore;
  readonly jobs: SqlJobStore;
  readonly consumers: ConsumerStore;
  readonly receipts: ReceiptStore;
  readonly usage: UsageStore;
  readonly buckets: BucketStore;
  readonly keys: SubjectKeyStore;
  readonly serials: SerialStore;
  readonly streams: StreamRecordStore;
  readonly scopeKeys?: ScopeKeyStore;
  nested<T>(fn: (u: SqlUnit) => Promise<T>, options?: NestedUnitOptions): Promise<T>;
  afterCommit(fn: () => void): void;
  /**
   * Work that runs inside the transaction once the unit's function has returned, in registration
   * order and before the commit tail, which stays the last step: the counter and lane locks are
   * taken only when this work is done. Work of a rolled-back savepoint is dropped.
   */
  beforeCommit(fn: () => Promise<void>): void;
}

/** What the adapter adds to a session to make a unit. */
export interface SqlUnitParts {
  /** The deployment's id: what `scope_id` holds for a deployment-scope unit. */
  readonly deploymentId: string;
  readonly clock: Clock;
  readonly entities: SqlEntityIndex;
  readonly keyWrapper?: SqlKeyWrapper;
}

/**
 * The unit over a Kysely transaction, shared by PGlite and `pg` (S-10). Each store is bound to the
 * unit's scope and runs through the scoping plugin; `nested` is a savepoint of the session. A unit
 * spans one scope (14.3.6): the one exception is a tenant unit's `readOnly` savepoint `as` a backend
 * scope, which swaps the scope settings, ends in a rollback that restores them, and lets the
 * database itself refuse writes.
 */
export function sqlUnit(session: SqlSession, parts: SqlUnitParts): SqlUnit {
  const root = sqlCommitBuffer(session.check);
  const build = (current: SqlSession, buffer: SqlCommitBuffer): SqlUnit => {
    const ctx = sqlUnitContext({
      namespace: current.namespace,
      scope: current.scope,
      readOnly: current.readOnly,
      deploymentId: parts.deploymentId,
      clock: parts.clock,
      keyWrapper: parts.keyWrapper,
      entities: parts.entities,
      db: current.db,
    });
    const scopeKeys = current.scope.level === 'deployment' ? sqlScopeKeyStore(ctx) : undefined;
    // Keys wrapped inside a deployment-scope unit read the scope keys through that unit, so an
    // adapter that runs one unit at a time never waits for a second one.
    const keyCtx: SqlUnitContext =
      scopeKeys === undefined
        ? ctx
        : { ...ctx, keyWrapper: parts.keyWrapper?.within?.(scopeKeys) ?? parts.keyWrapper };
    const unit: SqlUnit = {
      namespace: current.namespace,
      scope: current.scope,
      readOnly: current.readOnly,
      db: current.db,
      rows: sqlRowStore(ctx),
      events: sqlEventStore(ctx, buffer),
      jobs: sqlJobStore(ctx, buffer),
      consumers: sqlConsumerStore(ctx),
      receipts: sqlReceiptStore(ctx),
      usage: sqlUsageStore(ctx),
      buckets: sqlBucketStore(ctx),
      keys: sqlSubjectKeyStore(keyCtx),
      serials: sqlSerialStore(ctx),
      streams: sqlStreamRecordStore(ctx),
      ...(scopeKeys === undefined ? {} : { scopeKeys }),
      nested: async <T>(fn: (u: SqlUnit) => Promise<T>, options?: NestedUnitOptions) => {
        const target = options?.as ?? current.scope;
        if (
          options?.as !== undefined &&
          !(
            options.readOnly === true &&
            current.scope.level === 'tenant' &&
            target.level === 'backend' &&
            target.backendId === current.scope.backendId
          )
        ) {
          throw scopeForbidden(
            'a unit spans one scope: only a tenant unit may read the data of its own backend in a read-only savepoint',
            { scope: current.scope.level, target: target.level },
          );
        }
        const swapped = !sameScope(target, current.scope);
        const readOnly = current.readOnly || options?.readOnly === true;
        if (!swapped && readOnly === current.readOnly) {
          const mark = buffer.mark();
          try {
            return await current.nested(async (inner) => fn(build(inner, buffer)));
          } catch (error) {
            buffer.restore(mark);
            throw error;
          }
        }
        const outcome: { value?: T } = {};
        // A read-only savepoint always ends in a rollback, so work registered inside it is dropped.
        const mark = buffer.mark();
        try {
          return await current.nested(async (inner) => {
            const innerRun = async (statement: { sql: string; parameters: readonly unknown[] }) => {
              await inner.db.executeQuery(
                CompiledQuery.raw(statement.sql, [...statement.parameters]),
              );
            };
            if (swapped) await innerRun(scopeSettingsStatement(target, parts.deploymentId));
            if (readOnly && !current.readOnly) {
              await innerRun({
                sql: `select set_config('transaction_read_only', 'on', true)`,
                parameters: [],
              });
            }
            // A savepoint in another scope sees none of this unit's buffered events or lane changes.
            const value = await fn(
              build(
                { ...inner, scope: target, readOnly },
                swapped ? sqlCommitBuffer(session.check) : buffer,
              ),
            );
            if (readOnly) {
              outcome.value = value;
              throw new EndReadOnlySavepoint();
            }
            if (swapped) await innerRun(scopeSettingsStatement(current.scope, parts.deploymentId));
            return value;
          });
        } catch (error) {
          buffer.restore(mark);
          if (error instanceof EndReadOnlySavepoint) return outcome.value as T;
          throw error;
        }
      },
      afterCommit: (fn) => {
        current.afterCommit(fn);
      },
      beforeCommit: (fn) => {
        buffer.defer(fn);
      },
    };
    return unit;
  };
  // The one hook of the session: the unit's own work first, the commit tail last.
  const tail = session.readOnly
    ? undefined
    : sqlUnitContext({
        namespace: session.namespace,
        scope: session.scope,
        readOnly: session.readOnly,
        deploymentId: parts.deploymentId,
        clock: parts.clock,
        keyWrapper: parts.keyWrapper,
        entities: parts.entities,
        db: session.db,
      });
  session.beforeCommit(async () => {
    let ran = false;
    // Work may register more work, which runs too, still before the commit tail.
    for (let batch = root.takeWork(); batch.length > 0; batch = root.takeWork()) {
      for (const work of batch) await work();
      ran = true;
    }
    // Work that swallowed a statement error leaves the transaction aborted, and `commit` of an
    // aborted transaction answers `rollback` without an error: the probe fails with 25P02 then.
    if (ran) await runSql(session.db, { sql: 'select 1', parameters: [] });
    if (tail !== undefined) await runCommitTail(tail, root);
  });
  return build(session, root);
}
