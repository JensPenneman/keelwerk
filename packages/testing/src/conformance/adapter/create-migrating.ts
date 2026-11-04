import type { MigrationFile } from '@keelwerk/core';
import { migratingTable } from './migrating-table.ts';

/** The first file of the `conf` track. */
export const createMigrating: MigrationFile = {
  id: '0001-migrating',
  track: 'conf',
  steps: [{ op: 'createTable', entity: 'conf.migrating', table: migratingTable }],
};
