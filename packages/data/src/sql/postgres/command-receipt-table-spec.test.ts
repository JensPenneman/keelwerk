import { expect, test } from 'vitest';
import { entityTable } from '../entity-table.ts';
import { commandReceiptDescriptor } from './command-receipt-descriptor.ts';
import { commandReceiptTableSpec } from './command-receipt-table-spec.ts';

test("the receipt table's system columns are the layout of an invocation entity plus scope_id", () => {
  const entity = commandReceiptDescriptor();
  const table = entityTable(entity, 'app', 't');
  const layout = table.systemFields.map((name) => table.column(name)?.column);
  const declared = new Set(Object.values(entity.fields).map((field) => field.column));
  const spec = commandReceiptTableSpec(entity).columns.map((column) => column.name);
  expect(spec.filter((name) => !declared.has(name))).toEqual([table.scopeColumn, ...layout]);
  expect(table.scopeColumn).toBe('scope_id');
});
