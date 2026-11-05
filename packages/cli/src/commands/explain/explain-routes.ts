import type { CommandRoutes } from '../../routes/command-routes.ts';
import { explainCommand } from './explain.ts';

/** The `explain` command group (section 16.9.7): the authorization decision, `--dry-run` and `--trace`. */
export const explainRoutes: CommandRoutes = { explain: explainCommand };
