import type { ActionEntry } from '../../registry/action-entry.ts';
import type { InvocationSession } from '../invocation-session.ts';

/**
 * `admit` (section 9.2): tenant quotas, rate limits, kill switches and suspensions. M1 runs no
 * rule: the stage exists so the order is fixed, and WP-54 fills it. Nothing here wraps or skips a
 * later stage.
 */
export function admit(_action: ActionEntry, _session: InvocationSession): void {
  // No rule runs in M1.
}
