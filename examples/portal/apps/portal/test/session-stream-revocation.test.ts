import { defineApp, type KeelwerkError } from '@keelwerk/core';
import { live } from '@keelwerk/live';
import { accounts } from '@keelwerk/module-accounts';
import { auth } from '@keelwerk/module-auth';
import {
  createLocalClient,
  settleReactions,
  startTestRuntime,
  testOperator,
} from '@keelwerk/testing';
import { afterAll, describe, expect, test } from 'vitest';
import { credentialsOf, freshPerson, sessionCookie } from './support/people.ts';
import { localConfig } from './support/portal-config.ts';
import { portalDispatcher } from './support/portal-event-workers.ts';

/** The portal's own modules and the live module, whose hub holds the streams a session opens (S-151). */
const liveApp = defineApp({ id: 'portal', modules: [accounts, auth, live] as const });

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

/** A signed-up person's open `auth.sessionEvents` stream, and how it ends. */
async function openStream() {
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
  return { runtime, person, request, cookie, abort, ended };
}

describe('a stream a session opened ends when the session is logged out (S-151)', () => {
  test('a ticket the session issued opens auth.sessionEvents, and auth.logout ends the stream', async () => {
    const { request, cookie, abort, ended } = await openStream();
    expect((await request('auth.logout', {}, cookie)).ok).toBe(true);
    // One dispatcher pass and a drain carry logout's change to the feed; the stream must end from it alone.
    await settleReactions(dispatcher, (await started).drainJobs);
    // The runtime's clock stands still, and the hub counts its periodic revalidation (60 s) on that
    // clock, so only the change feed can end the stream. The case awaits that end; the case time limit fails it.
    const outcome = await ended;
    abort.abort();
    expect((outcome as KeelwerkError | undefined)?.kind).toBe('unauthenticated');
  }, 120_000);

  test('a stream of a person ends at the deactivation, before any revocation job has run', async () => {
    const { runtime, person, abort, ended } = await openStream();
    // The revocation jobs wait in the queue of the commands for the whole case.
    const target = runtime.adapter as { unit: typeof runtime.adapter.unit };
    const inner = target.unit.bind(runtime.adapter);
    target.unit = (namespace, scope, fn, options) =>
      inner(
        namespace,
        scope,
        (unit) =>
          fn({
            ...unit,
            jobs: {
              ...unit.jobs,
              take: (queue, worker, request) =>
                queue === 'commands'
                  ? Promise.resolve({ jobs: [], skippedLanes: 1 })
                  : unit.jobs.take(queue, worker, request),
            },
          }),
        options,
      );
    const scope = {
      level: 'tenant',
      backendId: runtime.backendId,
      tenantId: runtime.tenants.acme.id,
    } as const;
    const credentialRows = (): Promise<readonly { readonly revokedAt?: unknown }[]> =>
      runtime.sealed.unit(runtime.namespace, scope, async (unit) => {
        const descriptor = runtime.app.registry.entities.get('auth.credential')?.descriptor;
        if (descriptor === undefined) throw new Error('no auth.credential');
        return (await unit.rows.find(descriptor, { select: ['revokedAt'] })).rows;
      });
    const profileId = await runtime.sealed.unit(runtime.namespace, scope, async (unit) => {
      const descriptor = runtime.app.registry.entities.get('accounts.profile')?.descriptor;
      if (descriptor === undefined) throw new Error('no accounts.profile');
      const { rows } = await unit.rows.find(descriptor, { select: ['id', 'email'] });
      return String(rows.find((row) => row.email === person.identifier)?.id);
    });
    const deactivated = await createLocalClient(runtime, {
      principal: testOperator(),
      tenant: 'acme',
    }).attempt('accounts.profile.deactivate', { id: profileId as never, reason: 'left' });
    expect(deactivated.ok ? undefined : deactivated.error).toBeUndefined();
    // Only the change feed is carried: no job runs, so no credential is revoked when the stream ends.
    await settleReactions(dispatcher, async () => 0);
    const outcome = await ended;
    abort.abort();
    expect((outcome as KeelwerkError | undefined)?.kind).toBe('unauthenticated');
    expect((await credentialRows()).every((row) => row.revokedAt === undefined)).toBe(true);
  }, 120_000);
});
