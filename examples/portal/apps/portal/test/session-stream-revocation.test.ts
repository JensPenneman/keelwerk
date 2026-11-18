import { defineApp, type KeelwerkError } from '@keelwerk/core';
import { live } from '@keelwerk/live';
import { accounts } from '@keelwerk/module-accounts';
import { auth } from '@keelwerk/module-auth';
import { settleReactions, startTestRuntime } from '@keelwerk/testing';
import { afterAll, describe, expect, test } from 'vitest';
import { credentialsOf, freshPerson, sessionCookie } from './support/people.ts';
import { localConfig } from './support/portal-config.ts';
import { portalDispatcher } from './support/portal-event-workers.ts';

/** The portal's own modules and the live module, whose hub holds the streams a session opens (S-151). */
const liveApp = defineApp({ id: 'portal', modules: [accounts, auth, live] as const });

/** How long the feed has to end a stream after the logout, in real time. */
const feedPatienceMs = 10_000;
/** The clock stands still: the hub's periodic revalidation never comes due. */
const pinned = Temporal.Instant.from('2026-11-18T09:00:00Z');

const dispatcher = portalDispatcher();
const started = startTestRuntime(liveApp, {
  adapter: 'memory',
  clock: { now: () => pinned },
  operators: true,
  config: localConfig,
  workers: true,
  eventWorkers: [dispatcher],
});
afterAll(async () => (await started).stop());

describe('a stream a session opened ends when the session is logged out (S-151)', () => {
  test('a ticket the session issued opens auth.sessionEvents, and auth.logout ends the stream', async () => {
    const runtime = await started;
    const base = { transport: 'test', headers: { 'x-tenant': runtime.tenants.acme.id } };
    const request = (action: string, input: unknown, headers: Record<string, string> = {}) =>
      runtime.invoker.invoke({
        action,
        input,
        carrier: { ...base, headers: { ...base.headers, ...headers } },
        requestId: crypto.randomUUID(),
        signal: new AbortController().signal,
      });
    const person = freshPerson('streamed');
    expect((await request('auth.signUp', person)).ok).toBe(true);
    const login = await request('auth.login', credentialsOf(person));
    if (!login.ok) throw login.error;
    const { sessionToken } = login.value as { sessionToken: string };
    const cookie = { cookie: `${sessionCookie}=${sessionToken}` };
    const issued = await request('live.ticket', { action: 'auth.sessionEvents' }, cookie);
    if (!issued.ok) throw issued.error;
    const { ticket } = issued.value as { ticket: string };

    const abort = new AbortController();
    const iterator = runtime.invoker
      .subscribe<unknown, unknown>({
        action: 'auth.sessionEvents',
        input: {},
        carrier: {
          ...base,
          ticket: { value: ticket, endpoint: 'subscribe', action: 'auth.sessionEvents' },
        },
        requestId: crypto.randomUUID(),
        signal: abort.signal,
      })
      [Symbol.asyncIterator]();
    // The first frame proves the stream is open.
    const first = await iterator.next();
    expect(first.done).toBe(false);
    const ended = (async () => {
      try {
        for (;;) {
          const step = await iterator.next();
          if (step.done === true) return undefined;
        }
      } catch (error) {
        return error;
      }
    })();

    expect((await request('auth.logout', {}, cookie)).ok).toBe(true);
    // One dispatcher pass and a drain carry logout's change to the feed; the stream must end from it alone.
    await settleReactions(dispatcher, runtime.drainJobs);
    // The runtime's clock stands still, and the hub counts its periodic revalidation (60 s) on that
    // clock, so only the change feed can end the stream. It has a few seconds of real time to do so.
    const outcome = await Promise.race([
      ended,
      new Promise<'open'>((resolve) => {
        setTimeout(() => resolve('open'), feedPatienceMs).unref();
      }),
    ]);
    expect(outcome).not.toBe('open');
    abort.abort();
    expect((outcome as KeelwerkError | undefined)?.kind).toBe('unauthenticated');
  }, 120_000);
});
