import { buildRouteMap } from '@stricli/core';
import type { CliContext } from '../../context/cli-context.ts';
import type { CommandRoutes } from '../../routes/command-routes.ts';
import { surfaceDiffCommand } from './diff.ts';
import { surfaceRetireCommand } from './retire.ts';
import { surfaceUsageCommand } from './usage.ts';
import { versionNewCommand } from './version-new.ts';

/** The `surface` command group (section 16.9.7): `diff` against a git base and `version new` in the ledger. */
export const surfaceRoutes: CommandRoutes = {
  surface: buildRouteMap<string, CliContext>({
    routes: {
      diff: surfaceDiffCommand,
      retire: surfaceRetireCommand,
      usage: surfaceUsageCommand,
      version: buildRouteMap<string, CliContext>({
        routes: { new: versionNewCommand },
        docs: { brief: 'API versions in the ledger.' },
      }),
    },
    docs: { brief: 'Compare, cut, count and retire API versions.' },
  }),
};
