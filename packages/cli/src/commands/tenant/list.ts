import type { Command } from '@stricli/core';
import { buildCommand } from '@stricli/core';
import { backendIdOf } from '../../connections/backend-id-of.ts';
import type { CliContext } from '../../context/cli-context.ts';
import { handleFailure } from '../../routes/handle-failure.ts';
import { scopeOutput } from '../../routes/scope-output.ts';
import { runOperatorAction } from '../operator/run-operator-action.ts';
import { contextLink } from './context-link.ts';
import { tenantFlags } from './tenant-flags.ts';

function rowsOf(value: unknown): readonly Readonly<Record<string, unknown>>[] {
  const items = (value as { readonly items?: unknown } | null)?.items;
  return Array.isArray(items) ? (items as readonly Readonly<Record<string, unknown>>[]) : [];
}

/** `tenant list [--backend <name|id>]` (section 16.9.7): the tenants with their backend, domains and status. */
export const tenantListCommand: Command<CliContext> = buildCommand<
  Readonly<Record<string, unknown>>,
  [],
  CliContext
>({
  docs: { brief: 'List the tenants.' },
  parameters: { flags: tenantFlags() } as never,
  async func(this: CliContext, parsed) {
    const scoped = scopeOutput(this, parsed);
    try {
      const reference =
        typeof parsed.backend === 'string' ? parsed.backend : scoped.profile.backend;
      const backendId =
        reference === undefined ? undefined : await backendIdOf(contextLink(scoped), reference);
      await runOperatorAction(
        scoped,
        parsed,
        'core.tenant.query',
        {},
        (value) =>
          rowsOf(value)
            .filter((row) => backendId === undefined || row.backendId === backendId)
            .map((row) => ({
              id: row.id,
              name: row.name,
              backendId: row.backendId,
              domains: Array.isArray(row.domains) ? row.domains.join(',') : '',
              placement: row.placement ?? '',
              status: row.status,
            })),
        { allPages: true },
      );
    } catch (failure) {
      handleFailure(scoped, failure);
    }
  },
});
