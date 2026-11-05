import type { TableSpec } from '@keelwerk/core';
import { migrationColumn } from './migration-column.ts';

/** `conf__migrating`: the tenant column, an id and a label, tenant-scoped. */
export const migratingTable: TableSpec = {
  name: 'conf__migrating',
  columns: [
    migrationColumn('tenant_id', { field: null, kind: 'uuid', nullable: false }),
    migrationColumn('id', { kind: 'uuid', nullable: false }),
    migrationColumn('label'),
  ],
  primaryKey: ['id'],
  indexes: [],
  foreignKeys: [],
  scoped: 'tenant',
};
