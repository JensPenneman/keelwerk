import type { CommandRoutes } from '../../routes/command-routes.ts';
import { loginCommand } from './login.ts';
import { logoutCommand } from './logout.ts';

/** The `login` and `logout` commands (section 16.9.6): the credential of a remote profile. */
export const loginRoutes: CommandRoutes = { login: loginCommand, logout: logoutCommand };
