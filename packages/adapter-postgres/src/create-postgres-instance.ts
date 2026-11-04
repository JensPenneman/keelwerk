import { setTimeout as delay } from 'node:timers/promises';
import type {
  AdapterEnvironment,
  ChangeFeedSource,
  NamespaceRef,
  PlacementConfig,
  SchemaOperations,
  StorageScope,
  UnitOptions,
} from '@keelwerk/core';
import { errors } from '@keelwerk/core';
import type { SqlDb } from '@keelwerk/data';
import { Kysely, PostgresDialect } from 'kysely';
import type pg from 'pg';
import { checkRole } from './check-role.ts';
import { checkServerVersion } from './check-server-version.ts';
import type { PostgresAdapterInstance } from './postgres-adapter-instance.ts';
import type { PostgresAdapterOptions } from './postgres-adapter-options.ts';
import { postgresCapabilities } from './postgres-capabilities.ts';
import { postgresIdentity } from './postgres-identity.ts';
import { postgresNotWired } from './postgres-not-wired.ts';
import { postgresOptionsSchema } from './postgres-options-schema.ts';
import { createPostgresPool } from './postgres-pool.ts';
import { runPostgresUnit } from './postgres-unit.ts';
import type { PostgresUnitRequest } from './postgres-unit-request.ts';
import { runPostgresSession } from './run-postgres-session.ts';

const schemaOperations: SchemaOperations = {
  render: () => {
    throw postgresNotWired('schema.render');
  },
  apply: async () => {
    throw postgresNotWired('schema.apply');
  },
  history: async () => {
    throw postgresNotWired('schema.history');
  },
  provision: async () => {
    throw postgresNotWired('schema.provision');
  },
  introspect: async () => {
    throw postgresNotWired('schema.introspect');
  },
  lock: async () => {
    throw postgresNotWired('schema.lock');
  },
};

const changeFeed: ChangeFeedSource = {
  level: 'poll',
  wake: () => {
    throw postgresNotWired('feed.wake');
  },
};

interface Connection {
  readonly pool: pg.Pool;
  readonly db: Kysely<SqlDb>;
}

/**
 * One adapter of the `postgres` factory. Internal: it also offers `session`, the raw transaction
 * the stores are built over, which is not part of the contract and not exported from the package.
 */
export function createPostgresInstance(
  options: PostgresAdapterOptions,
  placement: PlacementConfig,
  env: AdapterEnvironment,
): PostgresAdapterInstance {
  let connection: Connection | undefined;
  const open = (): Connection => {
    if (connection === undefined) throw errors.unavailable('the postgres adapter is not connected');
    return connection;
  };
  const request = (
    namespace: NamespaceRef,
    scope: StorageScope,
    unitOptions: UnitOptions | undefined,
  ): PostgresUnitRequest => ({
    db: open().db,
    namespace,
    scope,
    options: unitOptions,
    deploymentId: env.deploymentId,
    log: env.log,
  });
  return {
    placementId: placement.id,
    connect: async () => {
      if (connection !== undefined) return postgresCapabilities();
      if (placement.strategy !== 'shared-tables') {
        throw errors.unsupported(
          `the postgres adapter runs the shared-tables placement only, not ${placement.strategy}`,
        );
      }
      if (placement.url === undefined || placement.url === '') {
        throw errors.validation(`the placement ${placement.id} needs a url`);
      }
      const parsed = postgresOptionsSchema['~standard'].validate(placement.options);
      if (parsed instanceof Promise || parsed.issues !== undefined) {
        throw errors.validation(`the placement ${placement.id} has invalid postgres options`);
      }
      const pool = createPostgresPool({
        url: placement.url,
        applicationName: options.applicationName ?? 'keelwerk',
        ...(placement.pool?.max === undefined ? {} : { max: placement.pool.max }),
        ...(placement.pool?.idleTimeoutMs === undefined
          ? {}
          : { idleTimeoutMs: placement.pool.idleTimeoutMs }),
        options: parsed.value,
        log: env.log,
      });
      try {
        const client = await pool.connect();
        try {
          await checkServerVersion(client);
          await checkRole(client);
        } finally {
          client.release();
        }
      } catch (error) {
        await pool.end();
        throw error;
      }
      connection = { pool, db: new Kysely<SqlDb>({ dialect: new PostgresDialect({ pool }) }) };
      return postgresCapabilities();
    },
    close: async (deadlineMs) => {
      const current = connection;
      connection = undefined;
      if (current === undefined) return;
      const ended = current.db.destroy();
      const timer = new AbortController();
      const timedOut = await Promise.race([
        ended.then(() => false),
        delay(deadlineMs, undefined, { signal: timer.signal }).then(
          () => true,
          () => false,
        ),
      ]);
      timer.abort();
      if (timedOut) env.log.warn('the postgres pool did not close before its deadline');
    },
    health: async () => {
      const current = connection;
      if (current === undefined) return { ok: false, detail: 'not connected' };
      try {
        await current.pool.query('select 1');
        return { ok: true };
      } catch (error) {
        return { ok: false, detail: error instanceof Error ? error.message : String(error) };
      }
    },
    unit: async (namespace, scope, fn, unitOptions) =>
      runPostgresUnit(request(namespace, scope, unitOptions), fn),
    session: async (namespace, scope, fn, unitOptions) =>
      runPostgresSession(request(namespace, scope, unitOptions), fn),
    schema: schemaOperations,
    feed: changeFeed,
    identity: async () => postgresIdentity(open().pool),
  };
}
