import type { CliContext } from '../context/cli-context.ts';
import type { OutputFormat } from '../output/output-format.ts';

/** The context with the output the command's `--output` and `--fields` chose, so results and errors agree. */
export function scopeOutput(
  context: CliContext,
  flags: Readonly<Record<string, unknown>>,
): CliContext {
  const fields =
    typeof flags.fields === 'string'
      ? flags.fields
          .split(',')
          .map((name) => name.trim())
          .filter((name) => name !== '')
      : undefined;
  const format = typeof flags.output === 'string' ? (flags.output as OutputFormat) : undefined;
  return {
    ...context,
    output: context.output.using({
      ...(format !== undefined && { format }),
      ...(fields !== undefined && { fields }),
    }),
  };
}
