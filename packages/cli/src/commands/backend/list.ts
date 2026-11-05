import type { Command } from '@stricli/core';
import { buildCommand } from '@stricli/core';
import type { CliContext } from '../../context/cli-context.ts';
import { operatorFlags } from '../operator/operator-flags.ts';
import { runOperatorAction } from '../operator/run-operator-action.ts';

function rowsOf(value: unknown): readonly Readonly<Record<string, unknown>>[] {
  const items = (value as { readonly items?: unknown } | null)?.items;
  return Array.isArray(items) ? (items as readonly Readonly<Record<string, unknown>>[]) : [];
}

/** `backend list` (section 16.9.7): the backends with their app, placement, API version and status; the configuration is not printed. */
export const backendListCommand: Command<CliContext> = buildCommand<
  Readonly<Record<string, unknown>>,
  [],
  CliContext
>({
  docs: { brief: 'List the backends.' },
  parameters: { flags: operatorFlags() } as never,
  async func(this: CliContext, parsed) {
    await runOperatorAction(
      this,
      parsed,
      'core.backend.query',
      {},
      (value) =>
        rowsOf(value).map((row) => ({
          id: row.id,
          name: row.name,
          app: row.app,
          placement: row.placement,
          apiVersion: row.apiVersion ?? '',
          status: row.status,
        })),
      { allPages: true },
    );
  },
});
