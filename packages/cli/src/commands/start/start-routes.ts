import type { CommandRoutes } from '../../routes/command-routes.ts';
import { startCommand } from './start.ts';

/** The `start` command group (section 16.9.7): one process of the deployment. */
export const startRoutes: CommandRoutes = { start: startCommand };
