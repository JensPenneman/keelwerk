import type { CliContext } from '../context/cli-context.ts';
import { usageFailure } from '../context/usage-failure.ts';
import { readArgumentText } from './read-argument-text.ts';

/** `--input`: inline JSON, `@file`, or `-` for standard input. */
export async function readInputArgument(context: CliContext, argument: string): Promise<unknown> {
  const text =
    argument === '-' ? await context.host.readStdin() : await readArgumentText(context, argument);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw usageFailure('--input is not valid JSON.');
  }
}
