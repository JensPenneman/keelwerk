import type { AskRename } from '@keelwerk/data';
import type { CliHost } from '../context/cli-host.ts';

/**
 * The planner's rename question (section 14.6.4): answered by the `--rename entity.from=to` flags
 * first; otherwise asked on the terminal when standard input is one; otherwise "no", which writes
 * a drop and an add. Injected into `db generate`, so tests answer without a terminal.
 */
export function renameAsk(host: CliHost, accepted: readonly string[]): AskRename {
  const answers = new Set(accepted.map((item) => item.trim()));
  return async ({ entity, from, to }) => {
    if (answers.has(`${entity}.${from}=${to}`)) return true;
    if (!host.stdinInteractive) return false;
    const answer = await host.promptLine(`${entity}: was ${from} renamed to ${to}? [y/N] `);
    return /^y(es)?$/i.test(answer.trim());
  };
}
