import type { Command } from '@stricli/core';
import { buildCommand } from '@stricli/core';
import type { CliContext } from '../../context/cli-context.ts';
import { usageFailure } from '../../context/usage-failure.ts';
import { handleFailure } from '../../routes/handle-failure.ts';
import { scopeOutput } from '../../routes/scope-output.ts';
import { operatorFlags } from '../operator/operator-flags.ts';
import { runOperatorAction } from '../operator/run-operator-action.ts';
import { textFlag } from '../operator/text-flag.ts';

/** `surface retire <version>` (18.5): re-pins what is pinned below the floor once the version is past its sunset. */
export const surfaceRetireCommand: Command<CliContext> = buildCommand<
  Readonly<Record<string, unknown>>,
  [string],
  CliContext
>({
  docs: { brief: 'Retire an API version after its sunset and re-pin what it served.' },
  parameters: {
    flags: { ...operatorFlags(), app: textFlag('The app id the version belongs to.', 'app') },
    positional: {
      kind: 'tuple',
      parameters: [
        { brief: 'The API version, YYYY-MM-DD.', parse: String, placeholder: 'version' },
      ],
    },
  } as never,
  async func(this: CliContext, parsed, version: string) {
    if (typeof parsed.app !== 'string') {
      handleFailure(scopeOutput(this, parsed), usageFailure('--app is required: name the app.'));
      return;
    }
    await runOperatorAction(this, parsed, 'core.retireApiVersion', { app: parsed.app, version });
  },
});
