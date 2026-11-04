import { pageItems } from './page-items.ts';
import { renderCell } from './render-cell.ts';
import { renderTable } from './render-table.ts';

/** The terminal form: a page as a table, a row as a key-value block, a receipt as its command id. */
export function renderText(value: unknown, fields?: readonly string[]): string {
  const rows = pageItems(value);
  if (rows !== undefined) {
    return renderTable(rows, fields);
  }
  if (typeof value === 'object' && value !== null) {
    const record = value as Readonly<Record<string, unknown>>;
    const names = fields !== undefined && fields.length > 0 ? fields : Object.keys(record);
    const width = Math.max(0, ...names.map((name) => name.length));
    return names
      .map((name) => `${`${name}:`.padEnd(width + 1)} ${renderCell(record[name])}`)
      .join('\n');
  }
  return renderCell(value);
}
