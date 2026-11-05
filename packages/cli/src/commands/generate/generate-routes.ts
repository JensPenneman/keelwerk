import type { CommandRoutes } from '../../routes/command-routes.ts';
import { generateCommand } from './generate.ts';

/** The `generate` command group (section 16.9.7): every artefact of section 13.7, written or checked. */
export const generateRoutes: CommandRoutes = { generate: generateCommand };
