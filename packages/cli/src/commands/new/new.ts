import type { Command } from '@stricli/core';
import { buildCommand } from '@stricli/core';
import type { CliContext } from '../../context/cli-context.ts';
import { newFlagParameters } from './new-flag-parameters.ts';
import type { NewFlags } from './new-flags.ts';
import { runNew } from './run-new.ts';

export const newCommand: Command<CliContext> = buildCommand<NewFlags, [string, string], CliContext>(
  {
    docs: {
      brief: 'Scaffold one part where its reference puts it.',
      fullDescription:
        'Creates files and never edits one: what only a hand-written file can hold is printed for you to add.\nExample: keelwerk new action auth.credential.revoke --kind command',
    },
    parameters: {
      flags: newFlagParameters,
      positional: {
        kind: 'tuple',
        parameters: [
          { brief: 'The kind of part.', parse: String, placeholder: 'kind' },
          {
            brief: 'The reference, such as auth.credential.revoke.',
            parse: String,
            placeholder: 'reference',
          },
        ],
      },
    },
    async func(this: CliContext, flags: NewFlags, kind: string, reference: string) {
      await runNew(this, kind, reference, flags);
    },
  },
);
