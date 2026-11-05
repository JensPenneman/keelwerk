import type { Command } from '@stricli/core';
import { buildCommand } from '@stricli/core';
import type { CliContext } from '../../context/cli-context.ts';
import { applyDeployment } from '../../db/apply-deployment.ts';
import { openDeployment } from '../../db/open-deployment.ts';
import { handleFailure } from '../../routes/handle-failure.ts';
import { scopeOutput } from '../../routes/scope-output.ts';
import { switchFlag } from '../../routes/switch-flag.ts';
import { dbFlags } from './db-flags.ts';
import { deploymentPathOf } from './deployment-path-of.ts';

/**
 * `db apply [--contract]` (alias `migrate`, section 14.6.4): applies the pending migration files of
 * every placement as a release step. Expand steps only unless `--contract` is given, which waits
 * for every live process to run this build (S-44) and otherwise fails with
 * `core.rollout_not_finalized`.
 */
export const dbApplyCommand: Command<CliContext> = buildCommand<
  Readonly<Record<string, unknown>>,
  [],
  CliContext
>({
  docs: {
    brief: 'Apply the pending migration files of the deployment.',
    fullDescription:
      'db apply [--contract]   expand steps; contract steps only when every live process runs this build',
  },
  parameters: {
    flags: dbFlags(
      {
        contract: switchFlag(
          'Apply the contract steps too, once every live process runs this build.',
        ),
      },
      true,
    ),
  } as never,
  async func(this: CliContext, parsed) {
    const scoped = scopeOutput(this, parsed);
    try {
      const opened = await openDeployment(deploymentPathOf(scoped, 'apply'), scoped.host.env);
      try {
        const outcomes = await applyDeployment(opened, {
          contract: parsed.contract === true,
          now: scoped.host.now(),
        });
        if (scoped.output.format === 'text' || scoped.output.format === 'table') {
          for (const outcome of outcomes) {
            for (const file of outcome.applied) {
              scoped.output.line(`${outcome.placement}/${outcome.app}: applied ${file}`);
            }
            for (const file of outcome.deferred) {
              scoped.output.line(
                `${outcome.placement}/${outcome.app}: deferred ${file} (contract step; run db apply --contract)`,
              );
            }
            for (const warning of outcome.warnings) scoped.output.note(`warning: ${warning}`);
          }
          if (
            outcomes.every(
              (outcome) => outcome.applied.length === 0 && outcome.deferred.length === 0,
            )
          ) {
            scoped.output.line('nothing to apply');
          }
        } else {
          scoped.output.value(outcomes);
        }
      } finally {
        await opened.close();
      }
    } catch (failure) {
      handleFailure(scoped, failure);
    }
  },
});
