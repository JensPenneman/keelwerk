import type { SurfaceAction } from '@keelwerk/core';
import type { CliHost } from '../../context/cli-host.ts';
import { usageFailure } from '../../context/usage-failure.ts';

type Fields = Readonly<Record<string, unknown>>;

/**
 * The input of a login action: every field of its shape the caller did not give is asked for,
 * a secret without echo, the rest echoed. With standard input not a terminal, the single secret is
 * read from standard input instead.
 */
export async function promptLoginInputs(
  host: CliHost,
  action: SurfaceAction,
  given: Fields,
): Promise<Fields> {
  const fields = action.input.kind === 'shape' ? Object.entries(action.input.fields) : [];
  const input: Record<string, unknown> = { ...given };
  if (!host.stdinInteractive) {
    const asked = fields.filter(([name, node]) => !(name in input) && node.access !== 'read');
    const secrets = asked.filter(([, node]) => node.kind === 'secret');
    const missing = asked.filter(([, node]) => node.kind !== 'secret' && !node.optional);
    if (missing.length > 0) {
      throw usageFailure(
        `Standard input is not a terminal: give ${missing
          .map(([name]) => name)
          .join(', ')} with --input.`,
      );
    }
    if (secrets.length > 1) {
      throw usageFailure(
        `Standard input carries one secret; "${action.ref}" asks for ${secrets
          .map(([name]) => name)
          .join(', ')}. Give the others with --input.`,
      );
    }
  }
  for (const [name, node] of fields) {
    if (name in input || node.access === 'read') continue;
    if (node.kind === 'secret') {
      input[name] = host.stdinInteractive
        ? await host.promptSecret(name)
        : (await host.readStdin()).replace(/\r?\n$/, '');
    } else if (!node.optional && host.stdinInteractive) {
      input[name] = await host.promptLine(`${name}: `);
    }
  }
  return input;
}
