import type {
  BucketStore,
  Clock,
  NamespaceRef,
  NestedUnitOptions,
  ReceiptStore,
  RowStore,
  ScopeKeyStore,
  SerialStore,
  StorageScope,
  SubjectKeyStore,
  UsageStore,
} from '@keelwerk/core';
import type { Kysely } from 'kysely';
import { CompiledQuery } from 'kysely';
import { scopeSettingsStatement } from './postgres/scope-settings-statement.ts';
import { scopeForbidden } from './scope-forbidden.ts';
import { sqlBucketStore } from './sql-bucket-store.ts';
import type { SqlDb } from './sql-db.ts';
import type { SqlEntityIndex } from './sql-entity-index.ts';
import type { SqlKeyWrapper } from './sql-key-wrapper.ts';
import { sqlReceiptStore } from './sql-receipt-store.ts';
import { sqlRowStore } from './sql-row-store.ts';
import { sqlScopeKeyStore } from './sql-scope-key-store.ts';
import { sqlSerialStore } from './sql-serial-store.ts';
import type { SqlSession } from './sql-session.ts';
import { sqlSubjectKeyStore } from './sql-subject-key-store.ts';
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
 * The unit as far as the stores below the event log go (14.3.2): rows, receipts, serials, usage,
 * buckets and keys, plus the scope keys of a deployment-scope unit (S-55). The event store and the
 * job store join with their work packages; `Unit` is this plus those two.
 */
export interface SqlUnit {
  readonly namespace: NamespaceRef;
  readonly scope: StorageScope;
  readonly readOnly: boolean;
  /** Kysely over the unit's transaction, as the application role, without the scoping plugin. */
  readonly db: Kysely<SqlDb>;
  readonly rows: RowStore;
  readonly receipts: ReceiptStore;
  readonly usage: UsageStore;
  readonly buckets: BucketStore;
  readonly keys: SubjectKeyStore;
  readonly serials: SerialStore;
  readonly scopeKeys?: ScopeKeyStore;
  nested<T>(fn: (u: SqlUnit) => Promise<T>, options?: NestedUnitOptions): Promise<T>;
  afterCommit(fn: () => void): void;
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
  const build = (current: SqlSession): SqlUnit => {
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
    const unit: SqlUnit = {
      namespace: current.namespace,
      scope: current.scope,
      readOnly: current.readOnly,
      db: current.db,
      rows: sqlRowStore(ctx),
      receipts: sqlReceiptStore(ctx),
      usage: sqlUsageStore(ctx),
      buckets: sqlBucketStore(ctx),
      keys: sqlSubjectKeyStore(ctx),
      serials: sqlSerialStore(ctx),
      ...(current.scope.level === 'deployment' ? { scopeKeys: sqlScopeKeyStore(ctx) } : {}),
      nested: async <T>(fn: (u: SqlUnit) => Promise<T>, options?: NestedUnitOptions) => {
        const target = options?.as ?? current.scope;
        const swapped = !sameScope(target, current.scope);
        const readOnly = current.readOnly || options?.readOnly === true;
        if (!swapped && readOnly === current.readOnly) {
          return current.nested(async (inner) => fn(build(inner)));
        }
        if (
          swapped &&
          !(
            options?.readOnly === true &&
            current.scope.level === 'tenant' &&
            target.level === 'backend'
          )
        ) {
          throw scopeForbidden(
            'a unit spans one scope: only a tenant unit may read backend data in a read-only savepoint',
            { scope: current.scope.level, target: target.level },
          );
        }
        const outcome: { value?: T } = {};
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
            const value = await fn(build({ ...inner, scope: target, readOnly }));
            if (readOnly) {
              outcome.value = value;
              throw new EndReadOnlySavepoint();
            }
            if (swapped) await innerRun(scopeSettingsStatement(current.scope, parts.deploymentId));
            return value;
          });
        } catch (error) {
          if (error instanceof EndReadOnlySavepoint) return outcome.value as T;
          throw error;
        }
      },
      afterCommit: (fn) => {
        current.afterCommit(fn);
      },
    };
    return unit;
  };
  return build(session);
}
