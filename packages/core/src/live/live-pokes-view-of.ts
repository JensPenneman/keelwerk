import { errors } from '../errors/errors.ts';
import type { InvocationSession } from '../invoker/invocation-session.ts';
import type { LivePokesView } from './live-pokes-view.ts';
import { livePokesViews } from './live-pokes-views.ts';

/**
 * The view of `session` for the pokes subscription bound to `bound` (the bound session itself, or
 * a renewed one with the same app and scope); `internal` for a session no pokes subscription
 * registered.
 */
export function livePokesViewOf(
  bound: InvocationSession,
  session: InvocationSession,
): Promise<LivePokesView> {
  const factory = livePokesViews.get(bound);
  if (factory === undefined) {
    return Promise.reject(
      errors.internal('The live hub was called with a session no pokes subscription registered.'),
    );
  }
  return factory(session);
}
