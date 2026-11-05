import type { CommandRoutes } from '../../routes/command-routes.ts';
import { initCommand } from './init.ts';

/** The `init` command group (section 16.9.7): a new project in the layout of section 23.1. */
export const initRoutes: CommandRoutes = { init: initCommand };
