import type { Command } from '@stricli/core';
import { buildCommand } from '@stricli/core';
import type { CliContext } from '../../context/cli-context.ts';
import { operatorFlags } from './operator-flags.ts';
import { runOperatorAction } from './run-operator-action.ts';

/** `operator token revoke <id>` (section 3.5): the token stops authenticating at once. */
export const tokenRevokeCommand: Command<CliContext> = buildCommand<
  Readonly<Record<string, unknown>>,
  [string],
  CliContext
>({
  docs: { brief: 'Revoke an operator token by its id.' },
  parameters: {
    flags: operatorFlags(),
    positional: {
      kind: 'tuple',
      parameters: [
        { brief: 'The token id, from `operator token list`.', parse: String, placeholder: 'id' },
      ],
    },
  } as never,
  async func(this: CliContext, parsed, id: string) {
    await runOperatorAction(this, parsed, 'core.operatorToken.revoke', { id }, (value) => {
      const row = value as Readonly<Record<string, unknown>>;
      return { id: row.id, label: row.label, revokedAt: row.revokedAt };
    });
  },
});
