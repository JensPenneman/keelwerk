import { buildRouteMap } from '@stricli/core';
import type { CliContext } from '../../context/cli-context.ts';
import type { CommandRoutes } from '../../routes/command-routes.ts';
import { dbApplyCommand } from './apply.ts';
import { dbCheckCommand } from './check.ts';
import { dbGenerateCommand } from './generate.ts';
import { dbPlanCommand } from './plan.ts';
import { dbStatusCommand } from './status.ts';
import { dbVerifyCommand } from './verify.ts';

/**
 * The `db` command group (section 16.9.7): `plan`, `generate` and `check` run on the workspace,
 * `apply` (also `migrate`), `status` and `verify` against the deployment file.
 */
export const dbRoutes: CommandRoutes = {
  db: buildRouteMap<string, CliContext>({
    routes: {
      plan: dbPlanCommand,
      generate: dbGenerateCommand,
      apply: dbApplyCommand,
      status: dbStatusCommand,
      check: dbCheckCommand,
      verify: dbVerifyCommand,
    },
    docs: { brief: 'The data layer: migrations, drift checks and chain verification.' },
  }),
  migrate: dbApplyCommand,
};
