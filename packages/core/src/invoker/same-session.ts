import type { InvocationSession } from './invocation-session.ts';

/** Whether two sessions belong to the same app and scope: a renewal may replace one with the other. */
export function sameSession(a: InvocationSession, b: InvocationSession): boolean {
  return a.app === b.app && JSON.stringify(a.scope) === JSON.stringify(b.scope);
}
