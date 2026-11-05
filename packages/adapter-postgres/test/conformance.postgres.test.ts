import type { EntityDescriptor, NamespaceRef } from '@keelwerk/core';
import { aesKeyWrapper, conformanceSnapshot } from '@keelwerk/data/conformance';
import { describeAdapterConformance } from '@keelwerk/testing';
import pg from 'pg';
import { inject } from 'vitest';
import { postgresAdapter } from '../src/postgres-adapter.ts';
import { createTestDatabase } from './support/create-test-database.ts';
import { testEnvironment } from './support/test-environment.ts';

const namespace: NamespaceRef = {
  id: 'ns-conformance',
  placementId: 'main',
  appId: 'conf',
  tenantId: null,
  root: 'conf',
};

const clockOf = () => {
  let offset = 0;
  return {
    now: () => Temporal.Now.instant().add({ milliseconds: offset }),
    advance: (milliseconds: number) => {
      offset += milliseconds;
    },
  };
};

const variants = [
  ['postgres', 'conformance_on', {}],
  [
    'postgres, rowLocks and notify off',
    'conformance_off',
    { accelerations: { rowLocks: false, notify: false } },
  ],
] as const;

for (const [name, database, accelerations] of variants) {
  describeAdapterConformance({
    name,
    placement: { id: 'main', strategy: 'shared-tables' },
    networked: true,
    factory: async (entities: readonly EntityDescriptor[]) => {
      inject('postgresCluster');
      const urls = await createTestDatabase(database);
      const known = new Map(entities.map((entity) => [entity.ref, entity]));
      const clock = clockOf();
      const adapter = postgresAdapter({
        ownerUrl: urls.adminUrl,
        clock,
        entities: (ref) => known.get(ref),
        keyWrapper: aesKeyWrapper(new Uint8Array(32).fill(7)),
        ...accelerations,
      }).create({ id: 'main', strategy: 'shared-tables', url: urls.appUrl }, testEnvironment());
      await adapter.connect();
      await adapter.schema.provision(namespace, [conformanceSnapshot(entities)]);
      const tables = new Set(entities.map((entity) => entity.table));
      return {
        adapter,
        namespace,
        clock,
        reset: async () => {
          const owner = new pg.Client({ connectionString: urls.adminUrl });
          await owner.connect();
          try {
            const found = await owner.query<{ tablename: string }>(
              `select tablename from pg_tables where schemaname = 'conf'`,
            );
            const kept: string[] = [];
            for (const { tablename } of found.rows) {
              const framework =
                tablename.startsWith('kw_') || tablename === 'core__command_receipt';
              if (framework || tables.has(tablename)) kept.push(`"conf"."${tablename}"`);
              else await owner.query(`drop table "conf"."${tablename}" cascade`);
            }
            await owner.query(`truncate ${kept.join(', ')} restart identity`);
          } finally {
            await owner.end();
          }
        },
        close: async () => {
          await adapter.close(5000);
        },
      };
    },
  });
}
