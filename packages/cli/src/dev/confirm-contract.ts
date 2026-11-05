import type { CliHost } from '../context/cli-host.ts';

/**
 * Asks, in the terminal, whether the contract and rebuild steps that wait may run (section 13.6,
 * S-47). Without a terminal there is nobody to ask: the steps stay deferred and the caller says so.
 */
export async function confirmContract(
  host: CliHost,
  deferred: readonly string[],
): Promise<boolean> {
  if (!host.stdinInteractive) return false;
  const answer = await host.promptLine(
    `${deferred.length} migration file(s) with contract or rebuild steps wait: ${deferred.join('; ')}. Apply them now? [y/N] `,
  );
  return /^y(es)?$/i.test(answer.trim());
}
