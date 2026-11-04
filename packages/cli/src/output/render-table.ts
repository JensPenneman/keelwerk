import { renderCell } from './render-cell.ts';

/** Total width the automatic columns may use. */
const budget = 100;

function isScalar(value: unknown): boolean {
  return value === null || typeof value !== 'object';
}

function automaticColumns(rows: readonly Readonly<Record<string, unknown>>[]): readonly string[] {
  const first = rows[0] ?? {};
  const names = Object.keys(first).filter((name) => isScalar(first[name]));
  const ordered = ['id', ...names.filter((name) => name !== 'id')].filter((name) => name in first);
  const chosen: string[] = [];
  let used = 0;
  for (const name of ordered) {
    const width = Math.max(name.length, ...rows.map((row) => renderCell(row[name]).length));
    if (chosen.length > 0 && used + width + 2 > budget) {
      break;
    }
    chosen.push(name);
    used += width + 2;
  }
  return chosen;
}

/** Rows as an aligned table: the id plus the fields that fit, or the named `fields`. */
export function renderTable(rows: readonly unknown[], fields?: readonly string[]): string {
  const records = rows.map((row) =>
    typeof row === 'object' && row !== null
      ? (row as Readonly<Record<string, unknown>>)
      : { value: row },
  );
  if (records.length === 0) {
    return '(no rows)';
  }
  const columns = fields !== undefined && fields.length > 0 ? fields : automaticColumns(records);
  const cells = records.map((row) => columns.map((name) => renderCell(row[name])));
  const widths = columns.map((name, index) =>
    Math.max(name.length, ...cells.map((line) => line[index]?.length ?? 0)),
  );
  const format = (line: readonly string[]) =>
    line
      .map((cell, index) => cell.padEnd(widths[index] ?? 0))
      .join('  ')
      .trimEnd();
  return [format(columns.map((name) => name.toUpperCase())), ...cells.map(format)].join('\n');
}
