import type { Command, RouteMap } from '@stricli/core';
import type { CliContext } from '../context/cli-context.ts';

/** The routes one command group contributes to the root of the tree. */
export type CommandRoutes = Readonly<Record<string, Command<CliContext> | RouteMap<CliContext>>>;
