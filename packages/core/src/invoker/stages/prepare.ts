import { KeelwerkError } from '../../errors/keelwerk-error.ts';
import type { ActionEntry } from '../../registry/action-entry.ts';

/**
 * `prepare` (section 9.2): the loads and inline effects of a synchronous command that declares
 * `prepare`, outside any unit. Queries and commands without `prepare` pass; the stage for a
 * declared `prepare` arrives with the write path, and until then such a command is refused.
 */
export function prepare(action: ActionEntry): void {
  if (action.prepare === undefined) return;
  throw new KeelwerkError({
    kind: 'not_implemented',
    code: 'core.not_implemented',
    message: `"${action.ref}" declares prepare, which this release does not run.`,
  });
}
