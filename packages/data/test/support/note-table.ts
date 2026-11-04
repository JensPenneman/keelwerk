import type { TableSpec } from '@keelwerk/core';
import { column } from './column.ts';

export const noteTable: TableSpec = {
  name: 'app__note',
  columns: [column('id', null, { kind: 'uuid', nullable: false }), column('title', 'title')],
  primaryKey: ['id'],
  indexes: [],
  foreignKeys: [],
  scoped: 'tenant',
};
