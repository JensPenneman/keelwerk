import type { ResultRow } from './result-row.ts';

const cell = (value: string | number | undefined): string => {
  if (value === undefined) return '';
  if (typeof value === 'string') return value;
  if (Number.isNaN(value)) return 'n/a';
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
};

/** Renders rows as a Markdown table; columns appear in first-seen order. */
export function formatTable(rows: readonly ResultRow[]): string {
  const columns: string[] = [];
  for (const row of rows) {
    for (const key of Object.keys(row)) if (!columns.includes(key)) columns.push(key);
  }
  const line = (cells: readonly string[]): string => `| ${cells.join(' | ')} |`;
  return [
    line(columns),
    line(columns.map(() => '---')),
    ...rows.map((row) => line(columns.map((column) => cell(row[column])))),
  ].join('\n');
}
