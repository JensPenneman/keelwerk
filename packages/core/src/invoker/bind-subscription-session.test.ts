import { describe, expect, test } from 'vitest';
import { errors } from '../errors/errors.ts';
import { bindSubscriptionSession } from './bind-subscription-session.ts';
import type { InvocationSession } from './invocation-session.ts';
import type { InvokerEnv } from './invoker-env.ts';
import type { Outcome } from './outcome.ts';
import { createSessionRegistry } from './session-registry.ts';

function envOf() {
  const sessions = createSessionRegistry();
  const env = { sessions, options: { environment: 'test' } } as unknown as InvokerEnv;
  const details = { resolved: {}, carrier: { transport: 'test' } } as never;
  /** A session that registers itself like `open` does; its revalidate answers `next`. */
  const sessionOf = (name: string, next: () => Outcome<InvocationSession>): InvocationSession => {
    const session = { principal: { subject: name }, revalidate: async () => next() } as never;
    sessions.register(session, details);
    return session;
  };
  return { env, sessions, sessionOf };
}

describe('bindSubscriptionSession', () => {
  test('revalidate runs the regate on the fresh session', async () => {
    const { env, sessionOf } = envOf();
    const fresh = sessionOf('fresh', () => {
      throw new Error('not revalidated again');
    });
    const first = sessionOf('first', () => ({ ok: true, value: fresh }));
    const seen: InvocationSession[] = [];
    const bound = bindSubscriptionSession(env, first, async (next) => {
      seen.push(next);
    });
    expect((await bound.revalidate()).ok).toBe(true);
    expect(seen).toEqual([fresh]);
  });

  test('a regate that throws forbidden answers that failure', async () => {
    const { env, sessionOf } = envOf();
    const fresh = sessionOf('fresh', () => ({ ok: false, error: errors.internal('x') }));
    const first = sessionOf('first', () => ({ ok: true, value: fresh }));
    const bound = bindSubscriptionSession(env, first, async () => {
      throw errors.forbidden('No longer allowed.');
    });
    const outcome = await bound.revalidate();
    expect(outcome.ok).toBe(false);
    expect(outcome.ok ? undefined : outcome.error).toMatchObject({
      kind: 'forbidden',
      code: 'core.forbidden',
    });
  });

  test('the fresh session is registered and bound again', async () => {
    const { env, sessions, sessionOf } = envOf();
    const third = sessionOf('third', () => ({ ok: false, error: errors.internal('x') }));
    const second = sessionOf('second', () => ({ ok: true, value: third }));
    const first = sessionOf('first', () => ({ ok: true, value: second }));
    const seen: string[] = [];
    const bound = bindSubscriptionSession(env, first, async (next) => {
      seen.push((next.principal as unknown as { subject: string }).subject);
    });
    expect(sessions.detailsOf(bound)).toBeDefined();
    const again = await bound.revalidate();
    if (!again.ok) throw again.error;
    expect(again.value).not.toBe(second);
    expect(sessions.detailsOf(again.value)).toBeDefined();
    expect((await again.value.revalidate()).ok).toBe(true);
    expect(seen).toEqual(['second', 'third']);
  });

  test('a failed reopen passes unchanged', async () => {
    const { env, sessionOf } = envOf();
    const error = errors.unauthenticated('Gone.');
    const first = sessionOf('first', () => ({ ok: false, error }));
    const bound = bindSubscriptionSession(env, first, async () => {
      throw new Error('never reached');
    });
    const outcome = await bound.revalidate();
    expect(outcome.ok ? undefined : outcome.error).toBe(error);
  });
});
