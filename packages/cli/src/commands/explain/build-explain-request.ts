import type { CliContext } from '../../context/cli-context.ts';
import { usageFailure } from '../../context/usage-failure.ts';
import { readInputArgument } from '../../routes/read-input-argument.ts';

function flag(flags: Readonly<Record<string, unknown>>, name: string): string | undefined {
  const value = flags[name];
  return typeof value === 'string' ? value : undefined;
}

function answersOf(flags: Readonly<Record<string, unknown>>): Record<string, unknown> | undefined {
  const given = flags.answer;
  if (!Array.isArray(given) || given.length === 0) return undefined;
  const answers: Record<string, unknown> = {};
  for (const entry of given as readonly string[]) {
    const at = entry.indexOf('=');
    if (at <= 0) throw usageFailure('--answer is <effect>=<json>.');
    try {
      answers[entry.slice(0, at)] = JSON.parse(entry.slice(at + 1)) as unknown;
    } catch {
      throw usageFailure(`--answer ${entry.slice(0, at)} is not valid JSON.`);
    }
  }
  return answers;
}

/**
 * The input of `core.explain` from the command line: `--trace <id>` prints a tree; a reference
 * evaluates the decision, and with `--dry-run` runs the command in a unit that rolls back. The
 * backend and tenant come from the connection (`--backend`, `--tenant` or the profile).
 */
export async function buildExplainRequest(
  context: CliContext,
  flags: Readonly<Record<string, unknown>>,
  ref: string | undefined,
): Promise<Readonly<Record<string, unknown>>> {
  const { backend, tenant } = context.profile;
  const scope = {
    ...(backend === undefined ? {} : { backend }),
    ...(tenant === undefined ? {} : { tenant }),
  };
  const id = flag(flags, 'trace');
  if (id !== undefined) {
    if (ref !== undefined) throw usageFailure('--trace takes an id, not an action reference.');
    return { mode: 'trace', id, ...scope };
  }
  if (ref === undefined) {
    throw usageFailure('Name an action reference to explain, or use --trace <id>.');
  }
  const dryRun = flags['dry-run'] === true;
  if (!dryRun && (flag(flags, 'command-id') !== undefined || flags.answer !== undefined)) {
    throw usageFailure('--command-id and --answer belong to --dry-run.');
  }
  const input = flag(flags, 'input');
  const as = flag(flags, 'as');
  const roles = flag(flags, 'roles');
  const commandId = flag(flags, 'command-id');
  const answers = answersOf(flags);
  return {
    mode: dryRun ? 'dry-run' : 'decision',
    ref,
    ...scope,
    ...(input === undefined ? {} : { input: await readInputArgument(context, input) }),
    ...(as === undefined ? {} : { as }),
    ...(roles === undefined
      ? {}
      : {
          roles: roles
            .split(',')
            .map((role) => role.trim())
            .filter((role) => role !== ''),
        }),
    ...(dryRun && commandId !== undefined ? { commandId } : {}),
    ...(dryRun && answers !== undefined ? { answers } : {}),
  };
}
