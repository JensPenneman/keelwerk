import { formatTable } from './format-table.ts';
import type { MeasurementResult } from './measurement-result.ts';

/** A measurement as a Markdown section: heading with the sections it checks, the table, the notes. */
export function renderResult(result: MeasurementResult): string {
  return [
    `## (${result.id}) ${result.title}`,
    '',
    `Sections: ${result.sections}`,
    '',
    formatTable(result.rows),
    '',
    ...result.notes.map((note) => `- ${note}`),
    '',
  ].join('\n');
}
