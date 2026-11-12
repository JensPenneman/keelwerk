import { postgresAdapter } from '@keelwerk/adapter-postgres';
import { defineApp } from '@keelwerk/core';
import { erasure } from '@keelwerk/events';
import { live } from '@keelwerk/live';
import { accounts } from '@keelwerk/module-accounts';
import { auth } from '@keelwerk/module-auth';
import {
  createLocalClient,
  startTestRuntime,
  type TestRuntime,
  testOperator,
} from '@keelwerk/testing';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createPortalDatabase, type PortalDatabase } from './support/create-portal-database.ts';
import { credentialsOf, freshPerson, sessionCookie } from './support/people.ts';
import { localConfig } from './support/portal-config.ts';

/** The portal's own modules and the live module, whose hub holds the streams a session opens. */
const liveApp = defineApp({ id: 'portal', modules: [accounts, auth, live] as const });

type Runtime = TestRuntime<typeof liveApp, 'acme' | 'globex'>;

describe('a live stream held by a second process when its session is erased (14.7.5, 15.4.2, 17.2.4)', () => {
  let urls: PortalDatabase;
  let first: Runtime;
  let second: Runtime;
  const worker = erasure({ pollMs: 3_600_000 });
  let now = Temporal.Now.instant();
  const clock = { now: () => now };

  beforeAll(async () => {
    urls = await createPortalDatabase('portal_erasure_live');
    const external = { factory: postgresAdapter({ ownerUrl: urls.adminUrl }), url: urls.appUrl };
    first = await startTestRuntime(liveApp, {
      external,
      operators: true,
      config: localConfig,
      workers: true,
      eventWorkers: [worker],
    });
    // The second process only serves: it holds the stream and never runs the erasure.
    second = await startTestRuntime(liveApp, {
      external,
      config: localConfig,
      clock,
      join: {
        backendId: first.backendId,
        tenants: { acme: first.tenants.acme.id, globex: first.tenants.globex.id },
      },
    });
  }, 180_000);

  afterAll(async () => {
    await second?.stop();
    await first?.stop();
  });

  const headersOf = (runtime: Runtime, extra: Record<string, string> = {}) => ({
    transport: 'test',
    headers: { 'x-tenant': runtime.tenants.acme.id, ...extra },
  });

  test('the stream ends unauthenticated and the next request with the cookie is anonymous', {
    timeout: 180_000,
  }, async () => {
    const request = (action: string, input: unknown, extra: Record<string, string> = {}) =>
      first.invoker.invoke({
        action,
        input,
        carrier: headersOf(first, extra),
        requestId: crypto.randomUUID(),
        signal: new AbortController().signal,
      });
    const person = freshPerson('streamed');
    expect((await request('auth.signUp', person)).ok).toBe(true);
    const login = await request('auth.login', credentialsOf(person));
    if (!login.ok) throw login.error;
    const { sessionToken } = login.value as { sessionToken: string };
    const cookie = { cookie: `${sessionCookie}=${sessionToken}` };
    const whoami = await request('auth.whoami', {}, cookie);
    if (!whoami.ok) throw whoami.error;
    const subject = String((whoami.value as { subject: string }).subject);

    // The second process opens the stream of the session's own changes and holds it.
    const frames: unknown[] = [];
    const ended = Promise.withResolvers<unknown>();
    const abort = new AbortController();
    const iterator = second.invoker
      .subscribe<unknown, unknown>({
        action: 'auth.sessionEvents',
        input: {},
        carrier: headersOf(second, cookie),
        requestId: crypto.randomUUID(),
        signal: abort.signal,
      })
      [Symbol.asyncIterator]();
    void (async () => {
      try {
        for (;;) {
          const step = await iterator.next();
          if (step.done === true) return ended.resolve(undefined);
          frames.push(step.value);
        }
      } catch (error) {
        ended.resolve(error);
      }
    })();
    const waitFor = async (until: () => boolean, what: string): Promise<void> => {
      const limit = Date.now() + 30_000;
      while (!until()) {
        if (Date.now() > limit) throw new Error(`timed out waiting for ${what}`);
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    };
    await waitFor(() => frames.length > 0, 'the first frame of the stream');
    // Before the erasure the same cookie resolves to the user in the second process.
    const before = await second.invoker.open(headersOf(second, cookie));
    expect(before.ok && before.value.principal.kind).toBe('user');

    const operator = createLocalClient(first, { principal: testOperator(), tenant: 'acme' });
    await operator.invoke(
      'core.eraseSubject',
      { subjectId: subject as never, reason: 'subjectRequest' },
      { prefer: 'async' },
    );
    await first.drainJobs();
    await worker.pass();
    await first.drainJobs();

    // The hub revalidates a session when a row it depends on changes, and in any case every minute
    // of the runtime's clock: if the change did not reach the second process yet, the clock moves
    // past the interval (by less than the session's idle time), so the stream ends either way.
    const patience = (ms: number) =>
      new Promise<'open'>((resolve) => setTimeout(() => resolve('open'), ms));
    let outcome = await Promise.race([ended.promise, patience(15_000)]);
    if (outcome === 'open') {
      now = now.add({ seconds: 65 });
      outcome = await Promise.race([ended.promise, patience(45_000)]);
    }
    abort.abort();
    expect(outcome, 'the stream ended').not.toBe('open');
    expect(outcome).toMatchObject({ kind: 'unauthenticated' });

    const after = await second.invoker.open(headersOf(second, cookie));
    expect(after.ok && after.value.principal.kind).toBe('anonymous');
    expect(after.ok && after.value.clearCookies).toEqual([sessionCookie]);
  });
});
