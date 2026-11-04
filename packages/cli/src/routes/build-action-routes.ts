import type { ApiSurface } from '@keelwerk/core';
import type { Command, CommandBuilderArguments, RouteMap } from '@stricli/core';
import { buildCommand, buildRouteMap } from '@stricli/core';
import type { CliContext } from '../context/cli-context.ts';
import { buildActionCommand } from './build-action-command.ts';
import { commonFlags } from './common-flags.ts';
import { scopeOutput } from './scope-output.ts';

type ListFlags = CommandBuilderArguments<
  Readonly<Record<string, unknown>>,
  [],
  CliContext
>['parameters']['flags'];

export interface ActionRoutesOptions {
  /** The route that lists the references; it has no dot, so it never meets an action reference. */
  readonly listName?: string;
  /** Called for an alias that is not routed because it equals a route name or an earlier alias. */
  readonly onSkippedAlias?: (alias: string, reference: string) => void;
}

/**
 * The routes under `call`, one per action reference, from the surface (section 16.9.2). The
 * reference is always the route name (`accounts.profile.deactivate`); `cli.route` and
 * `cli.aliases` add further names for it. An alias that equals a route name, the list route or an
 * earlier alias is skipped and reported through `onSkippedAlias`. The routes are exactly the
 * surface's actions: a module that is not selected has none, and no name is reserved for a module.
 */
export function buildActionRoutes(
  surface: ApiSurface,
  options: ActionRoutesOptions = {},
): RouteMap<CliContext> {
  const listName = options.listName ?? 'list';
  const routes: Record<string, Command<CliContext>> = {};
  for (const action of surface.actions) {
    if (!(action.ref in routes) && action.ref !== listName) {
      routes[action.ref] = buildActionCommand(action, action.ref);
    }
  }
  const aliases: Record<string, string> = {};
  for (const action of surface.actions) {
    const hint = action.hints.cli;
    const names = [
      ...(hint?.route !== undefined && hint.route.length > 0 ? [hint.route.join('.')] : []),
      ...(hint?.aliases ?? []),
    ];
    for (const alias of names) {
      if (alias === action.ref) {
        continue;
      }
      if (alias in routes || alias === listName || alias in aliases) {
        options.onSkippedAlias?.(alias, action.ref);
      } else {
        aliases[alias] = action.ref;
      }
    }
  }
  const list = buildCommand<Readonly<Record<string, unknown>>, [], CliContext>({
    docs: { brief: 'List the action references of this deployment.' },
    parameters: { flags: commonFlags() as unknown as ListFlags },
    func(this: CliContext, flags) {
      scopeOutput(this, flags).output.value(
        surface.actions.map((action) => ({
          ref: action.ref,
          kind: action.kind,
          description: action.description,
        })),
      );
    },
  });
  return buildRouteMap<string, CliContext>({
    routes: { ...routes, [listName]: list },
    aliases,
    docs: {
      brief: `Invoke an action by its reference (${surface.actions.length} actions at ${surface.apiVersion}).`,
    },
  });
}
