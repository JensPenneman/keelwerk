import { buildRouteMap } from '@stricli/core';
import type { CliContext } from '../../context/cli-context.ts';
import type { CommandRoutes } from '../../routes/command-routes.ts';
import { tokenIssueCommand } from './token-issue.ts';
import { tokenListCommand } from './token-list.ts';
import { tokenRevokeCommand } from './token-revoke.ts';

/** The `operator` command group (section 16.9.7): `operator token issue|revoke|list` over the operator endpoint. */
export const operatorRoutes: CommandRoutes = {
  operator: buildRouteMap<string, CliContext>({
    routes: {
      token: buildRouteMap<string, CliContext>({
        routes: {
          issue: tokenIssueCommand,
          revoke: tokenRevokeCommand,
          list: tokenListCommand,
        },
        docs: { brief: 'Issue, revoke and list operator tokens.' },
      }),
    },
    docs: { brief: 'Administer the deployment.' },
  }),
};
