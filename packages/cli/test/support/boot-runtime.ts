import type {
  AdapterCapabilities,
  DataAdapter,
  DataAdapterFactory,
  Runtime,
  SchemaPlanner,
} from '@keelwerk/core';
import { defineApp, secret, startRuntime } from '@keelwerk/core';
import {
  applyPending,
  buildTrackSnapshot,
  checkMigrationHistory,
  commandReceiptDdl,
  isTrackActive,
  loadMigrations,
  maskCapabilities,
  memoryAdapter,
  orderTracks,
} from '@keelwerk/data';
import { pgliteAdapter } from '@keelwerk/data/pglite';

function planner(): SchemaPlanner {
  return {
    kind: 'schemaPlanner',
    provides: [],
    snapshots: (entries, options) => buildTrackSnapshot(entries, options),
    orderTracks: (modules, tracks) => orderTracks(modules, tracks),
    isTrackActive: (track, selected) => isTrackActive(track, selected),
    loadTracks: (module, migrations) => loadMigrations(module, migrations),
    applyPending: (schema, namespace, tracks) => applyPending(schema, namespace, tracks),
    checkHistory: (history, tracks) => checkMigrationHistory(history, tracks),
  };
}

function pgliteFactory(): DataAdapterFactory {
  const role = 'kw_app';
  return {
    id: 'pglite',
    dialect: 'postgres',
    options: { '~standard': { version: 1, vendor: 'keelwerk', validate: (value) => ({ value }) } },
    create: (placement, env) => {
      const inner = pgliteAdapter(
        { deploymentId: env.deploymentId, tracer: env.tracer },
        {
          placementId: placement.id,
          role,
          ...(env.keyWrapper === undefined ? {} : { keyWrapper: env.keyWrapper }),
        },
      );
      const adapter = inner as unknown as DataAdapter;
      return {
        ...adapter,
        placementId: placement.id,
        connect: async () => {
          const capabilities = await inner.connect();
          await inner.asOwner(async (database) => {
            const existing = await database.query('select 1 from pg_roles where rolname = $1', [
              role,
            ]);
            if (existing.rows.length === 0) {
              await database.query(
                `create role "${role}" nosuperuser nobypassrls nocreatedb nocreaterole nologin`,
              );
            }
          });
          return capabilities;
        },
        schema: {
          ...inner.schema,
          provision: async (namespace, snapshots, options) => {
            await inner.schema.provision(namespace, snapshots, options);
            await inner.asOwner(async (database) => {
              const table = `"${namespace.root}".core__command_receipt`;
              const present = await database.query('select to_regclass($1) as found', [table]);
              if ((present.rows[0] as { found: string | null } | undefined)?.found != null) return;
              for (const statement of commandReceiptDdl(namespace.root))
                await database.query(statement);
              await database.query(`grant select, insert, update, delete on ${table} to "${role}"`);
            });
          },
        },
      };
    },
  };
}

export interface Booted {
  readonly runtime: Runtime;
  readonly adapters: Map<string, DataAdapter>;
  readonly capabilities: Map<string, AdapterCapabilities>;
}

export async function bootRuntime(kind: 'memory' | 'pglite', mask: boolean): Promise<Booted> {
  const inner = kind === 'memory' ? memoryAdapter() : pgliteFactory();
  const adapters = new Map<string, DataAdapter>();
  const capabilities = new Map<string, AdapterCapabilities>();
  const factory: DataAdapterFactory = {
    ...inner,
    create: (placement, env) => {
      const adapter = inner.create(placement, env);
      const watched: DataAdapter = {
        ...adapter,
        connect: async () => {
          const found = await adapter.connect();
          const reported = mask
            ? maskCapabilities(found, [
                'rowLocks',
                'changeFeed',
                'search',
                'positionPaging',
                'broadcast',
                'jobs',
              ])
            : found;
          capabilities.set(placement.id, reported);
          return reported;
        },
      };
      adapters.set(placement.id, watched);
      return watched;
    },
  };
  const runtime = await startRuntime(
    {
      apps: [defineApp({ id: 'demo', modules: [] })],
      infrastructure: [factory, planner()],
      control: { adapter: kind },
      placements: { main: { adapter: kind, strategy: 'shared-tables' } },
      tenantResolution: [{ kind: 'header', header: 'x-tenant' }],
      keys: { masterKey: secret('KW_DOCTOR_KEY') },
    },
    {
      role: 'all',
      listen: false,
      environment: 'test',
      env: Object.fromEntries([['KW_DOCTOR_KEY', Buffer.alloc(32, 7).toString('base64')]]),
    },
  );
  return { runtime, adapters, capabilities };
}
