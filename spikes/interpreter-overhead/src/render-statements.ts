import { cellLabel } from './cell-label.ts';
import { renderTable } from './render-table.ts';
import type { StatementProfile } from './statement-profile.ts';

const totalCalls = (profile: StatementProfile): number =>
  profile.statements.reduce((sum, statement) => sum + statement.callsPerCommand, 0);

const totalMicros = (profile: StatementProfile): number =>
  profile.statements.reduce(
    (sum, statement) => sum + statement.callsPerCommand * statement.microsPerCall,
    0,
  );

const shorten = (query: string): string => query.replaceAll('|', '/').slice(0, 110);

/**
 * Two tables: the statements and the server execution time per command of every profile, and,
 * statement by statement, the calls per command of every profile (a statement the form does not
 * send shows nothing).
 */
export function renderStatements(profiles: readonly StatementProfile[]): string {
  const label = (profile: StatementProfile): string =>
    `${cellLabel(profile.cell)}, ${profile.cell.count} loads`;
  const totals = renderTable(
    ['form', 'commands', 'statements per command', 'server execution us per command'],
    profiles.map((profile) => [
      label(profile),
      String(profile.commands),
      totalCalls(profile).toFixed(2),
      totalMicros(profile).toFixed(1),
    ]),
  );
  const queries = [
    ...new Set(profiles.flatMap((profile) => profile.statements.map((entry) => entry.query))),
  ].sort();
  const detail = renderTable(
    ['statement', ...profiles.map(label)],
    queries.map((query) => [
      shorten(query),
      ...profiles.map((profile) => {
        const found = profile.statements.find((entry) => entry.query === query);
        return found === undefined
          ? ''
          : `${found.callsPerCommand.toFixed(2)} x ${found.microsPerCall.toFixed(0)} us`;
      }),
    ]),
  );
  return `${totals}\n\n${detail}`;
}
