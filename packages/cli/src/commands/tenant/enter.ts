import type { Command } from '@stricli/core';
import { buildCommand } from '@stricli/core';
import type { CliContext } from '../../context/cli-context.ts';
import { usageFailure } from '../../context/usage-failure.ts';
import { handleFailure } from '../../routes/handle-failure.ts';
import { scopeOutput } from '../../routes/scope-output.ts';
import { runOperatorAction } from '../operator/run-operator-action.ts';
import { textFlag } from '../operator/text-flag.ts';
import { tenantFlags } from './tenant-flags.ts';
import { tenantIdOf } from './tenant-id-of.ts';

/**
 * `tenant enter <name|id> --reason <text> [--backend <name|id>]` (sections 8.8 and 16.9.7): an
 * alias of `call core.tenant.enter`. The entry is logged on the tenant and lets this operator
 * work in it for 12 hours, with `--tenant <id>` on action calls.
 */
export const tenantEnterCommand: Command<CliContext> = buildCommand<
  Readonly<Record<string, unknown>>,
  [string],
  CliContext
>({
  docs: {
    brief: 'Enter a tenant as the operator.',
    fullDescription:
      'Logs why the operator works in the tenant. For the next 12 hours `call <action> --tenant <id>` acts inside it.',
  },
  parameters: {
    flags: {
      ...tenantFlags(),
      reason: textFlag('Why the operator enters the tenant; kept in its history.', 'text'),
    },
    positional: {
      kind: 'tuple',
      parameters: [{ brief: 'The tenant name or id.', parse: String, placeholder: 'name|id' }],
    },
  } as never,
  async func(this: CliContext, parsed, reference: string) {
    const scoped = scopeOutput(this, parsed);
    try {
      if (typeof parsed.reason !== 'string' || parsed.reason.trim() === '') {
        throw usageFailure('--reason is required.');
      }
      const backend = typeof parsed.backend === 'string' ? parsed.backend : scoped.profile.backend;
      await runOperatorAction(
        scoped,
        parsed,
        'core.tenant.enter',
        { id: await tenantIdOf(scoped, reference, backend), reason: parsed.reason },
        undefined,
      );
    } catch (failure) {
      handleFailure(scoped, failure);
    }
  },
});
