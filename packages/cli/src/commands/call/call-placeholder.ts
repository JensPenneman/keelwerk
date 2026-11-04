import type { Command } from '@stricli/core';
import { buildCommand } from '@stricli/core';
import type { CliContext } from '../../context/cli-context.ts';
import { usageFailure } from '../../context/usage-failure.ts';

/** `call` before a surface is loaded (help, or no connection): it explains how to reach one. */
export const callPlaceholder: Command<CliContext> = buildCommand<
  NonNullable<unknown>,
  string[],
  CliContext
>({
  docs: {
    brief: 'Invoke an action by its dotted reference (accounts.profile.deactivate).',
    fullDescription:
      'The references come from the API surface of the selected deployment. Choose one with --profile, --socket or KEELWERK_PROFILE; `keelwerk call list` prints them.',
  },
  parameters: {
    flags: {},
    positional: {
      kind: 'array',
      parameter: { brief: 'The reference, then its arguments.', parse: String, placeholder: 'ref' },
    },
  },
  func() {
    throw usageFailure(
      'No connection. Use --profile <name>, --socket <path>, or run inside a project.',
    );
  },
});
