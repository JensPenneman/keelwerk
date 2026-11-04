import type { Command } from '@stricli/core';
import { buildCommand } from '@stricli/core';
import type { CliContext } from '../../context/cli-context.ts';
import type { CompletionShell } from './completion-script.ts';
import { completionScript } from './completion-script.ts';

export const completionCommand: Command<CliContext> = buildCommand<
  NonNullable<unknown>,
  [CompletionShell],
  CliContext
>({
  docs: {
    brief: 'Print a completion script.',
    fullDescription:
      'The script calls back into the binary, which answers from the route map of the cached surface without a network call.\nExample: keelwerk completion zsh > ~/.zfunc/_keelwerk',
  },
  parameters: {
    flags: {},
    positional: {
      kind: 'tuple',
      parameters: [
        {
          brief: 'The shell.',
          placeholder: 'bash|zsh|fish',
          parse: (input: string): CompletionShell => {
            if (input === 'bash' || input === 'zsh' || input === 'fish') {
              return input;
            }
            throw new Error(`"${input}" is not bash, zsh or fish.`);
          },
          proposeCompletions: (partial: string) =>
            ['bash', 'zsh', 'fish'].filter((shell) => shell.startsWith(partial)),
        },
      ],
    },
  },
  func(this: CliContext, _flags, shell: CompletionShell) {
    this.output.line(completionScript(shell));
  },
});
