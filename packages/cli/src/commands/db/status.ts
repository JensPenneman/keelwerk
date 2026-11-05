import type { Command } from '@stricli/core';
import { buildCommand } from '@stricli/core';
import type { CliContext } from '../../context/cli-context.ts';
import { openDeployment } from '../../db/open-deployment.ts';
import { statusOfDeployment } from '../../db/status-of-deployment.ts';
import { handleFailure } from '../../routes/handle-failure.ts';
import { scopeOutput } from '../../routes/scope-output.ts';
import { dbFlags } from './db-flags.ts';
import { deploymentPathOf } from './deployment-path-of.ts';

/** `db status` (section 14.6.4): the applied and the pending migration files per placement and app. */
export const dbStatusCommand: Command<CliContext> = buildCommand<
  Readonly<Record<string, unknown>>,
  [],
  CliContext
>({
  docs: {
    brief: 'List applied and pending migration files.',
    fullDescription:
      'db status   per placement and app: what the history holds and what the files add',
  },
  parameters: { flags: dbFlags({}, true) } as never,
  async func(this: CliContext, parsed) {
    const scoped = scopeOutput(this, parsed);
    try {
      const opened = await openDeployment(deploymentPathOf(scoped, 'status'), scoped.host.env);
      try {
        const statuses = await statusOfDeployment(opened);
        if (scoped.output.format === 'text' || scoped.output.format === 'table') {
          for (const status of statuses) {
            scoped.output.line(`${status.placement}/${status.app}`);
            for (const file of status.applied) scoped.output.line(`  applied  ${file}`);
            for (const file of status.pending) scoped.output.line(`  pending  ${file}`);
          }
          if (statuses.length === 0) scoped.output.line('no placement holds a schema');
        } else {
          scoped.output.value(statuses);
        }
      } finally {
        await opened.close();
      }
    } catch (failure) {
      handleFailure(scoped, failure);
    }
  },
});
