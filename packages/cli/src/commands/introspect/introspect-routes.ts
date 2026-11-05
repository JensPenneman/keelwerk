import { buildRouteMap } from '@stricli/core';
import type { CliContext } from '../../context/cli-context.ts';
import type { CommandRoutes } from '../../routes/command-routes.ts';
import { surfaceDiffCommand } from '../surface/diff.ts';
import { actionRows } from './action-rows.ts';
import { introspectCompositionCommand } from './introspect-composition-command.ts';
import { introspectEntityCommand } from './introspect-entity.ts';
import { introspectRowsCommand } from './introspect-rows-command.ts';
import { introspectSummaryCommand } from './introspect-summary.ts';
import { moduleRows } from './module-rows.ts';

/**
 * The `introspect` command group (section 16.9.7): the surface of the connected deployment as a
 * tree or rows, the composition report for policies and extension points, and `diff` as an alias
 * of `surface diff`.
 */
export const introspectRoutes: CommandRoutes = {
  introspect: buildRouteMap<string, CliContext>({
    routes: {
      tree: introspectSummaryCommand,
      modules: introspectRowsCommand('List the modules.', moduleRows),
      actions: introspectRowsCommand('List the actions.', actionRows),
      entity: introspectEntityCommand,
      policies: introspectCompositionCommand('List the effective rules.', (report) => report.rules),
      extensions: introspectCompositionCommand(
        'List the extension points and their fillers.',
        (report) => report.extensionPoints,
      ),
      diff: surfaceDiffCommand,
    },
    defaultCommand: 'tree',
    docs: { brief: 'Show what the deployment offers.' },
  }),
};
