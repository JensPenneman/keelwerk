import type { Command } from '@stricli/core';
import { buildCommand } from '@stricli/core';
import type { CliContext } from '../../context/cli-context.ts';
import { newFlagParameters } from './new-flag-parameters.ts';
import type { NewFlags } from './new-flags.ts';
import { runNew } from './run-new.ts';

/** `keelwerk module new <id>`: the alias of `keelwerk new module <id>` (section 16.9.8). */
export const moduleNewCommand: Command<CliContext> = buildCommand<NewFlags, [string], CliContext>({
  docs: { brief: 'Alias of keelwerk new module.' },
  parameters: {
    flags: newFlagParameters,
    positional: {
      kind: 'tuple',
      parameters: [{ brief: 'The module id.', parse: String, placeholder: 'id' }],
    },
  },
  async func(this: CliContext, flags: NewFlags, id: string) {
    await runNew(this, 'module', id, flags);
  },
});
