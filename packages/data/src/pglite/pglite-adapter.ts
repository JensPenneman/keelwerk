import { AsyncLocalStorage } from 'node:async_hooks';
import { PGlite } from '@electric-sql/pglite';
import type {
  AdapterCapabilities,
  AdapterEnvironment,
  Clock,
  DataAdapter,
  EntityDescriptor,
  NamespaceRef,
  StorageScope,
  UnitOptions,
} from '@keelwerk/core';
import { mapSqlError } from '../sql/map-sql-error.ts';
import { assertRoleName } from '../sql/postgres/assert-role-name.ts';
import { beginUnitStatements } from '../sql/postgres/begin-unit-statements.ts';
import { postgresSchemaOperations } from '../sql/postgres/postgres-schema-operations.ts';
import { runInSpan } from '../sql/run-in-span.ts';
import { sqlEntityIndex } from '../sql/sql-entity-index.ts';
import type { SqlKeyWrapper } from '../sql/sql-key-wrapper.ts';
import { pgliteCapabilities } from './pglite-capabilities.ts';
import { pgliteChangeFeed } from './pglite-change-feed.ts';
import { pgliteIdentity } from './pglite-identity.ts';
import { PgliteReentrantUnitError } from './pglite-reentrant-unit-error.ts';
import { pgliteSchemaConnection } from './pglite-schema-connection.ts';
import { type PgliteUnit, pgliteUnit } from './pglite-unit.ts';

function scopeIdOf(scope: StorageScope, deploymentId: string): string | undefined {
  switch (scope.level) {
    case 'tenant':
      return scope.tenantId;
    case 'backend':
      return scope.backendId;
    case 'deployment':
      return deploymentId;
    case 'namespace':
      return undefined;
  }
}

const systemClock: Clock = { now: () => Temporal.Now.instant() };

/** How `pgliteAdapter` opens its database. */
export interface PgliteAdapterOptions {
  /** A directory that survives restarts (`.keelwerk/dev-db`, S-47); omitted: in memory. */
  readonly dataDir?: string;
  readonly placementId?: string;
  /** The role every unit drops to; provision it with `provisionApplicationRole`. Default `kw_app`. */
  readonly role?: string;
  /**
   * Receives the error of an `afterCommit` callback that threw. Default: rethrown from a
   * microtask, so it surfaces as an uncaught error without rejecting the committed unit.
   */
  readonly onAfterCommitError?: (error: unknown) => void;
  /** The time source of bucket refills and key timestamps; default: the system clock. */
  readonly clock?: Clock;
  /**
   * Finds the descriptor of a relation's target by entity ref. The adapter also learns every
   * descriptor a store call names, so this is needed only for a target no call has named yet.
   */
  readonly entities?: (ref: string) => EntityDescriptor | undefined;
  /** Wraps the key material of `kw_subject_keys` and `kw_value_keys`; without it the key stores refuse. */
  readonly keyWrapper?: SqlKeyWrapper;
}

/**
 * The adapter as far as the work packages so far build it: connection, capabilities, units with the
 * stores below the event log (`PgliteUnit`), the change feed, identity and the schema operations.
 * WP-31 and WP-36 add the event store and the job store to the unit.
 */
export interface PgliteAdapter extends Omit<DataAdapter, 'unit'> {
  unit<T>(
    namespace: NamespaceRef,
    scope: StorageScope,
    fn: (u: PgliteUnit) => Promise<T>,
    options?: UnitOptions,
  ): Promise<T>;
  /**
   * Runs `fn` as the database owner, serialised with the units: provisioning and migrations (S-14).
   * Row-level security does not restrict the owner.
   */
  asOwner<T>(fn: (database: PGlite) => Promise<T>): Promise<T>;
}

/**
 * PGlite as a data adapter (section 14.3.7): the PostgreSQL dialect in process, one connection,
 * units serialised one after the other. Every unit starts with `set local role` to the
 * application role so row-level security applies (S-14); a unit that commits in a scope wakes the
 * in-process change feed afterwards.
 */
export function pgliteAdapter(
  env: Pick<AdapterEnvironment, 'deploymentId'> & Partial<Pick<AdapterEnvironment, 'tracer'>>,
  options: PgliteAdapterOptions = {},
): PgliteAdapter {
  const entities = sqlEntityIndex(options.entities);
  const clock = options.clock ?? systemClock;
  const role = assertRoleName(options.role ?? 'kw_app');
  const inside = new AsyncLocalStorage<true>();
  const feed = pgliteChangeFeed();
  let database: PGlite | undefined;
  let queue: Promise<unknown> = Promise.resolve();
  let closed = false;

  const open = (): PGlite => {
    if (database === undefined) throw new Error('the PGlite adapter is not connected');
    if (closed) throw new Error('the PGlite adapter is closed');
    return database;
  };
  /** One at a time: PGlite has one session, and a unit owns it from `begin` to `commit`. */
  const serialised = <T>(work: () => Promise<T>): Promise<T> => {
    if (inside.getStore() === true) throw new PgliteReentrantUnitError();
    const run = (): Promise<T> => inside.run(true, work);
    const result = queue.then(run, run);
    queue = result.catch(() => undefined);
    return result;
  };

  const asOwner = async <T>(fn: (database: PGlite) => Promise<T>): Promise<T> => {
    const db = open();
    return serialised(async () => fn(db));
  };

  return {
    placementId: options.placementId ?? 'pglite',
    feed: feed.source,
    schema: postgresSchemaOperations(pgliteSchemaConnection(asOwner), { role }),
    async connect(): Promise<AdapterCapabilities> {
      if (database === undefined) {
        database = options.dataDir === undefined ? new PGlite() : new PGlite(options.dataDir);
      }
      await database.waitReady;
      // A unit that drops to a superuser or a bypass role would skip row-level security (S-14).
      const attributes = await database.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
        'select rolsuper, rolbypassrls from pg_roles where rolname = $1',
        [role],
      );
      const found = attributes.rows[0];
      if (found !== undefined && (found.rolsuper || found.rolbypassrls)) {
        throw new Error(`role ${role} can bypass row-level security; units refuse it`);
      }
      closed = false;
      return pgliteCapabilities();
    },
    async close(deadlineMs: number): Promise<void> {
      if (database === undefined || closed) return;
      closed = true;
      const timer: { id?: ReturnType<typeof setTimeout> } = {};
      await Promise.race([
        queue,
        new Promise<void>((resolve) => {
          timer.id = setTimeout(resolve, deadlineMs);
        }),
      ]);
      clearTimeout(timer.id);
      await database.close();
      database = undefined;
    },
    async health(): Promise<{ readonly ok: boolean; readonly detail?: string }> {
      try {
        const db = open();
        await serialised(async () => db.query('select 1'));
        return { ok: true };
      } catch (error) {
        return { ok: false, detail: error instanceof Error ? error.message : String(error) };
      }
    },
    async identity(): Promise<{ readonly systemId: string; readonly timeline: string }> {
      const db = open();
      return serialised(async () => pgliteIdentity(db));
    },
    asOwner,
    async unit<T>(
      namespace: NamespaceRef,
      scope: StorageScope,
      fn: (u: PgliteUnit) => Promise<T>,
      unitOptions: UnitOptions = {},
    ): Promise<T> {
      const db = open();
      const readOnly = unitOptions.readOnly === true;
      const begun = beginUnitStatements({
        scope,
        readOnly,
        role,
        deploymentId: env.deploymentId,
        ...(unitOptions.isolation === undefined ? {} : { isolation: unitOptions.isolation }),
        ...(unitOptions.timeoutMs === undefined ? {} : { timeoutMs: unitOptions.timeoutMs }),
      });
      const { result, afterCommit } = await serialised(async () =>
        runInSpan(
          env.tracer,
          'keelwerk.unit',
          { 'keelwerk.scope.level': scope.level, 'keelwerk.unit.read_only': readOnly },
          async () => {
            unitOptions.signal?.throwIfAborted();
            await db.query(begun.begin);
            try {
              for (const statement of begun.settings) {
                await db.query(statement.sql, [...statement.parameters]);
              }
              const opened = pgliteUnit(db, namespace, scope, readOnly, {
                deploymentId: env.deploymentId,
                clock,
                entities,
                ...(options.keyWrapper === undefined ? {} : { keyWrapper: options.keyWrapper }),
              });
              const value = await fn(opened.unit);
              unitOptions.signal?.throwIfAborted();
              await opened.runBeforeCommit();
              await db.query('commit');
              return { result: value, afterCommit: opened.takeAfterCommit() };
            } catch (error) {
              await db.query('rollback');
              throw mapSqlError(error);
            }
          },
        ),
      );
      const scopeId = scopeIdOf(scope, env.deploymentId);
      if (!readOnly && scopeId !== undefined) feed.publish(namespace.id, [scopeId]);
      // The unit has committed: a callback that throws is reported, never allowed to reject the
      // call (a caller would retry a command that already committed) or to stop the others.
      for (const callback of afterCommit) {
        try {
          callback();
        } catch (error) {
          if (options.onAfterCommitError === undefined) {
            queueMicrotask(() => {
              throw error;
            });
          } else {
            options.onAfterCommitError(error);
          }
        }
      }
      return result;
    },
  };
}
