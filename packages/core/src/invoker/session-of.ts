import { KeelwerkError } from '../errors/keelwerk-error.ts';
import type { Invocation } from './invocation.ts';
import type { InvocationSession } from './invocation-session.ts';
import type { InvokerEnv } from './invoker-env.ts';
import { openSession } from './open-session.ts';
import type { Outcome } from './outcome.ts';

/** The session an invocation runs under: its own when this invoker made it, else a fresh one; a foreign object is `internal`. */
export async function sessionOf(
  env: InvokerEnv,
  inv: Invocation<unknown>,
): Promise<Outcome<InvocationSession>> {
  if (inv.session === undefined)
    return openSession(env, inv.carrier, { signal: inv.signal, requestId: inv.requestId });
  if (env.sessions.detailsOf(inv.session) === undefined) {
    return {
      ok: false,
      error: new KeelwerkError({
        kind: 'internal',
        code: 'core.internal',
        message: 'The session was not created by this invoker.',
      }),
    };
  }
  return { ok: true, value: inv.session };
}
