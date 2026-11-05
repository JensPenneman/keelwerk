import type { Command } from '@stricli/core';
import { buildCommand } from '@stricli/core';
import type { CliContext } from '../../context/cli-context.ts';
import { usageFailure } from '../../context/usage-failure.ts';
import { handleFailure } from '../../routes/handle-failure.ts';
import { readInputArgument } from '../../routes/read-input-argument.ts';
import { scopeOutput } from '../../routes/scope-output.ts';
import { runOperatorAction } from '../operator/run-operator-action.ts';
import { backendCreateFlags } from './backend-create-flags.ts';

function required(flags: Readonly<Record<string, unknown>>, name: string): string {
  const value = flags[name];
  if (typeof value !== 'string' || value === '') throw usageFailure(`--${name} is required.`);
  return value;
}

/**
 * `backend create <name> --app <id> --placement <name> [--api-version <date>] [--settings <json>]`
 * (section 16.9.7, S-109): an alias of `call core.backend.create`, the explicit control command
 * the runtime serves over the operator socket and in project mode alike; `--settings` fills `config`.
 */
export const backendCreateCommand: Command<CliContext> = buildCommand<
  Readonly<Record<string, unknown>>,
  [string],
  CliContext
>({
  docs: { brief: 'Create a backend.' },
  parameters: {
    flags: backendCreateFlags(),
    positional: {
      kind: 'tuple',
      parameters: [{ brief: 'The backend name.', parse: String, placeholder: 'name' }],
    },
  } as never,
  async func(this: CliContext, parsed, name: string) {
    const scoped = scopeOutput(this, parsed);
    try {
      const settings =
        typeof parsed.settings === 'string'
          ? await readInputArgument(scoped, parsed.settings)
          : undefined;
      const apiVersion =
        typeof parsed['api-version'] === 'string' ? parsed['api-version'] : undefined;
      await runOperatorAction(
        scoped,
        parsed,
        'core.backend.create',
        {
          name,
          app: required(parsed, 'app'),
          placement: required(parsed, 'placement'),
          ...(apiVersion !== undefined && { apiVersion }),
          ...(settings !== undefined && { config: settings }),
        },
        undefined,
        {
          ...(typeof parsed['command-id'] === 'string' && { commandId: parsed['command-id'] }),
        },
      );
    } catch (failure) {
      handleFailure(scoped, failure);
    }
  },
});
