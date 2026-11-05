import type { CommandRoutes } from '../../routes/command-routes.ts';
import { buildCommandOf } from './build.ts';

/** The `build` command group (section 16.9.7): the checks of section 13.8, then the emit. */
export const buildRoutes: CommandRoutes = { build: buildCommandOf };
