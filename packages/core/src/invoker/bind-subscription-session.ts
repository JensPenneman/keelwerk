import { errors } from '../errors/errors.ts';
import type { InvocationSession } from './invocation-session.ts';
import type { InvokerEnv } from './invoker-env.ts';
import { mapUnknownError } from './map-unknown-error.ts';

/**
 * A copy of `session`, registered with its details, whose `revalidate()` reopens the session, runs
 * `regate` on the fresh one (a throw becomes the failed outcome: the subscription's own gate, its
 * rules, flag gates and principal list, is decided again, 16.3.4) and answers the fresh session
 * bound again. A failed reopen passes unchanged. The hub calls it, so a stream ends when its
 * principal or its permission to subscribe is gone.
 */
export function bindSubscriptionSession(
  env: InvokerEnv,
  session: InvocationSession,
  regate: (fresh: InvocationSession) => Promise<void>,
): InvocationSession {
  const details = env.sessions.detailsOf(session);
  if (details === undefined) throw errors.internal('The session was not created by this invoker.');
  const bound: InvocationSession = {
    ...session,
    revalidate: async () => {
      const reopened = await session.revalidate();
      if (!reopened.ok) return reopened;
      try {
        await regate(reopened.value);
      } catch (error) {
        return { ok: false, error: mapUnknownError(error, env.options.environment) };
      }
      return { ok: true, value: bindSubscriptionSession(env, reopened.value, regate) };
    },
  };
  env.sessions.register(bound, details);
  return bound;
}
