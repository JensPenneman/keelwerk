import type { SurfaceAction } from '@keelwerk/core';
import type { CliContext } from '../context/cli-context.ts';
import { usageFailure } from '../context/usage-failure.ts';
import type { FlagEntry } from './flag-entry.ts';
import type { PositionalSlot } from './positional-slot.ts';
import { readInputArgument } from './read-input-argument.ts';
import { setInputPath } from './set-input-path.ts';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasPath(target: Readonly<Record<string, unknown>>, path: readonly string[]): boolean {
  let cursor: unknown = target;
  for (const key of path) {
    if (!isRecord(cursor) || !(key in cursor)) {
      return false;
    }
    cursor = cursor[key];
  }
  return true;
}

/**
 * The input of one invocation (section 16.9.4): `--input` first, then the flags, then the
 * positional arguments, so explicit flags win. Secrets come from standard input or a prompt.
 * The result is wire JSON; the action's schema validates it in the pipeline.
 */
export async function assembleInput(
  context: CliContext,
  action: SurfaceAction,
  entries: readonly FlagEntry[],
  slots: readonly PositionalSlot[],
  flags: Readonly<Record<string, unknown>>,
  positionals: readonly unknown[],
): Promise<unknown> {
  const whole =
    typeof flags.input === 'string' ? await readInputArgument(context, flags.input) : {};
  if (!isRecord(whole)) {
    if (entries.some((entry) => flags[entry.key] !== undefined)) {
      throw usageFailure('--input must be a JSON object when flags are given as well.');
    }
    return whole;
  }
  const input: Record<string, unknown> = structuredClone(whole);
  for (const entry of entries) {
    const given = flags[entry.key];
    if (entry.role === 'value' && given !== undefined) {
      setInputPath(input, entry.path, flags[`no-${entry.key}`] === true ? false : given);
    } else if (
      entry.role === 'negate' &&
      given === true &&
      flags[entry.key.slice(3)] === undefined
    ) {
      setInputPath(input, entry.path, false);
    } else if (entry.role === 'stdin') {
      if (given === true) {
        setInputPath(input, entry.path, (await context.host.readStdin()).replace(/\r?\n$/, ''));
      } else if (!entry.node.optional && !hasPath(input, entry.path)) {
        if (!context.host.stdinInteractive) {
          throw usageFailure(
            `${entry.path.join('.')} is a secret and standard input is not a terminal; give it with --${entry.key}.`,
          );
        }
        setInputPath(input, entry.path, await context.host.promptSecret(entry.path.join('.')));
      }
    }
  }
  for (const [index, slot] of slots.entries()) {
    const given = positionals[index];
    if (given !== undefined) {
      setInputPath(input, [slot.name], given);
    }
  }
  if (flags['if-version'] !== undefined) {
    input.ifVersion = flags['if-version'];
  }
  return Object.keys(input).length === 0 && action.input.kind === 'void' ? undefined : input;
}
