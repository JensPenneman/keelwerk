import type { CommandRoutes } from '../../routes/command-routes.ts';
import { completionCommand } from './completion-command.ts';

/** `completion bash|zsh|fish` (section 16.9.9). */
export const completionRoutes: CommandRoutes = { completion: completionCommand };
