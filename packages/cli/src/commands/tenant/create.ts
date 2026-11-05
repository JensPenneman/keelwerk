import type { Command } from '@stricli/core';
import { buildCommand } from '@stricli/core';
import { backendIdOf } from '../../connections/backend-id-of.ts';
import type { CliContext } from '../../context/cli-context.ts';
import { usageFailure } from '../../context/usage-failure.ts';
import { handleFailure } from '../../routes/handle-failure.ts';
import { scopeOutput } from '../../routes/scope-output.ts';
import { runOperatorAction } from '../operator/run-operator-action.ts';
import { contextLink } from './context-link.ts';
import { tenantCreateFlags } from './tenant-create-flags.ts';

/**
 * `tenant create <name> --backend <name|id> [--domain host]... [--placement p] [--api-version d]`
 * (section 16.9.7, S-26): an alias of `call core.tenant.create`, with the backend by name or id.
 * The host names are the tenant's domains.
 */
export const tenantCreateCommand: Command<CliContext> = buildCommand<
  Readonly<Record<string, unknown>>,
  [string],
  CliContext
>({
  docs: { brief: 'Create a tenant.' },
  parameters: {
    flags: tenantCreateFlags(),
    positional: {
      kind: 'tuple',
      parameters: [{ brief: 'The tenant name.', parse: String, placeholder: 'name' }],
    },
  } as never,
  async func(this: CliContext, parsed, name: string) {
    const scoped = scopeOutput(this, parsed);
    try {
      const reference =
        typeof parsed.backend === 'string' ? parsed.backend : scoped.profile.backend;
      if (reference === undefined) throw usageFailure('--backend is required.');
      const domains = Array.isArray(parsed.domain) ? (parsed.domain as readonly string[]) : [];
      await runOperatorAction(
        scoped,
        parsed,
        'core.tenant.create',
        {
          backendId: await backendIdOf(contextLink(scoped), reference),
          name,
          domains,
          ...(typeof parsed.placement === 'string' && { placement: parsed.placement }),
          ...(typeof parsed['api-version'] === 'string' && { apiVersion: parsed['api-version'] }),
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
