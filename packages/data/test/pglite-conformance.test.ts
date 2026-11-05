import type { DataAdapter, EntityDescriptor, NamespaceRef } from '@keelwerk/core';
import { describeAdapterConformance } from '@keelwerk/testing';
import { aesKeyWrapper, conformanceSnapshot } from '../src/conformance/index.ts';
import { pgliteAdapter, pgliteSchemaConnection } from '../src/pglite/index.ts';
import { withCommandReceipts } from '../src/sql/postgres/with-command-receipts.ts';
import { offsetClock } from './support/offset-clock.ts';

const placement = { id: 'main', strategy: 'shared-tables' } as const;
const namespace: NamespaceRef = {
  id: 'ns-conformance',
  placementId: 'main',
  appId: 'conf',
  tenantId: null,
  root: 'conf',
};
const role = 'kw_app';

describeAdapterConformance({
  name: 'pglite',
  placement,
  deploymentId: '00000000-0000-4000-8000-0000000000d1',
  networked: false,
  factory: async (entities: readonly EntityDescriptor[]) => {
    const known = new Map(entities.map((entity) => [entity.ref, entity]));
    const clock = offsetClock();
    const inner = pgliteAdapter(
      { deploymentId: '00000000-0000-4000-8000-0000000000d1' },
      {
        placementId: 'main',
        role,
        clock,
        entities: (ref) => known.get(ref),
        keyWrapper: aesKeyWrapper(new Uint8Array(32).fill(7)),
      },
    );
    await inner.connect();
    await inner.asOwner(async (database) => {
      await database.query(
        `create role "${role}" nosuperuser nobypassrls nocreatedb nocreaterole nologin`,
      );
    });
    const adapter: DataAdapter = {
      ...inner,
      unit: (scopeNamespace, scope, fn, unitOptions) =>
        inner.unit(scopeNamespace, scope, fn, unitOptions),
      schema: withCommandReceipts(inner.schema, pgliteSchemaConnection(inner.asOwner), role),
    };
    await adapter.schema.provision(namespace, [conformanceSnapshot(entities)]);
    const tables = new Set(entities.map((entity) => entity.table));
    return {
      adapter,
      namespace,
      clock,
      reset: async () => {
        await inner.asOwner(async (database) => {
          const found = await database.query<{ tablename: string }>(
            'select tablename from pg_tables where schemaname = $1',
            ['conf'],
          );
          const names = found.rows.map((row) => row.tablename);
          for (const name of names) {
            const framework = name.startsWith('kw_') || name === 'core__command_receipt';
            if (!framework && !tables.has(name)) {
              await database.query(`drop table "conf"."${name}" cascade`);
            }
          }
          const kept = names.filter(
            (name) =>
              name.startsWith('kw_') || tables.has(name) || name === 'core__command_receipt',
          );
          if (kept.length > 0) {
            await database.query(`truncate ${kept.map((name) => `"conf"."${name}"`).join(', ')}`);
          }
        });
        clock.advance(0);
      },
      close: async () => {
        await adapter.close(1000);
      },
    };
  },
});
