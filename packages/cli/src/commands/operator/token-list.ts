import type { Command } from '@stricli/core';
import { buildCommand } from '@stricli/core';
import type { CliContext } from '../../context/cli-context.ts';
import { operatorFlags } from './operator-flags.ts';
import { runOperatorAction } from './run-operator-action.ts';

function rowsOf(value: unknown): readonly Readonly<Record<string, unknown>>[] {
  const items = (value as { readonly items?: unknown } | null)?.items;
  return Array.isArray(items) ? (items as readonly Readonly<Record<string, unknown>>[]) : [];
}

/** `operator token list` (section 3.5): the tokens with their label, expiry and revocation; never a secret. */
export const tokenListCommand: Command<CliContext> = buildCommand<
  Readonly<Record<string, unknown>>,
  [],
  CliContext
>({
  docs: { brief: 'List the operator tokens.' },
  parameters: { flags: operatorFlags() } as never,
  async func(this: CliContext, parsed) {
    await runOperatorAction(
      this,
      parsed,
      'core.operatorToken.query',
      {},
      (value) =>
        rowsOf(value).map((row) => ({
          id: row.id,
          label: row.label,
          expiresAt: row.expiresAt,
          revokedAt: row.revokedAt ?? '',
        })),
      { allPages: true },
    );
  },
});
