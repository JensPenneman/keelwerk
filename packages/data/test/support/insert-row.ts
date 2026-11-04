import type { PGlite } from '@electric-sql/pglite';
import type { EntityDescriptor, StorageRow } from '@keelwerk/core';
import { bind } from './bind.ts';

export async function insertRow(
  pg: PGlite,
  entity: EntityDescriptor,
  scope: string,
  row: StorageRow,
): Promise<void> {
  const bound = Object.entries(row).map(([name, value]) => bind(entity, name, value));
  const columns = ['tenant_id', ...bound.map(([column]) => column)];
  const values = [scope, ...bound.map(([, value]) => value)];
  const marks = values.map((_, index) => `$${index + 1}`).join(', ');
  await pg.query(
    `insert into app.${entity.table} (${columns.join(', ')}) values (${marks})`,
    values,
  );
}
