import type { CliContext } from '../context/cli-context.ts';
import { usageFailure } from '../context/usage-failure.ts';

/** `@path` reads a file, `@@text` is the literal `@text`, anything else is the text itself. */
export async function readArgumentText(context: CliContext, input: string): Promise<string> {
  if (input.startsWith('@@')) {
    return input.slice(1);
  }
  if (!input.startsWith('@')) {
    return input;
  }
  const path = input.slice(1);
  const text = await context.host.files.readText(
    path.startsWith('/') ? path : `${context.host.cwd}/${path}`,
  );
  if (text === undefined) {
    throw usageFailure(`Cannot read ${path}.`);
  }
  return text;
}
