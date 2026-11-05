import type { CommandRoutes } from '../../routes/command-routes.ts';
import { doctorCommand } from './doctor.ts';

/** The `doctor` command group (section 16.9.7): the environment, project and deployment checks and the layout pass. */
export const doctorRoutes: CommandRoutes = { doctor: doctorCommand };
