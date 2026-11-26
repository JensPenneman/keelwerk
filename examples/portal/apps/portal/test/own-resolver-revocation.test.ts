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
import { holder, holderHeader } from './support/holder/module.ts';
import { credentialsOf, freshPerson } from './support/people.ts';
import { localConfig } from './support/portal-config.ts';
import { portalDispatcher } from './support/portal-event-workers.ts';

/** An app whose own resolver (module `holder`) answers a user of the profile kind, beside the portal's modules. */
const ownApp = defineApp({ id: 'portal', modules: [accounts, auth, live, holder] as const });

/** The clock stands still: no case here waits for a time or moves one. */
const pinned = Temporal.Instant.from('2026-11-18T09:00:00Z');

const dispatcher = portalDispatcher();
const started = startTestRuntime(ownApp, {
  adapter: 'memory',
  tenants: ['acme', 'globex'],
  clock: { now: () => pinned },
  operators: true,
  config: localConfig,
  workers: true,
  eventWorkers: [dispatcher],
});
afterAll(async () => (await started).stop());

/** A profile the operator makes, and the way to act as it through the app's own resolver. */
async function holderOfProfile(name: string) {
  const runtime = await started;
  const admin = createLocalClient(runtime, { principal: testOperator(), tenant: 'acme' });
  const { id } = await admin.invoke('accounts.profile.create', {
    displayName: name,
    email: `${name}@example.org`,
  });
  return holderOf(runtime, admin, id);
}

function holderOf(
  runtime: Awaited<typeof started>,
  admin: ReturnType<typeof createLocalClient<typeof ownApp>>,
  id: string,
) {
  const at = (scopeHeader: Record<string, string>) => ({
    transport: 'test',
    headers: { ...scopeHeader, [holderHeader]: id },
  });
  const atTenant = at({ 'x-tenant': runtime.tenants.acme.id });
  const atOtherTenant = at({ 'x-tenant': runtime.tenants.globex.id });
  const atBackend = at({ 'x-backend': runtime.backendId });
  const whoami = (carrier: typeof atTenant) =>
    runtime.invoker.invoke({
      action: 'auth.whoami',
      input: {},
      carrier,
      requestId: crypto.randomUUID(),
      signal: new AbortController().signal,
    });
  const deactivate = async () => {
    const done = await admin.attempt('accounts.profile.deactivate', {
      id: id as never,
      reason: 'left',
    });
    expect(done.ok ? undefined : done.error).toBeUndefined();
  };
  return { runtime, atTenant, atOtherTenant, atBackend, whoami, deactivate };
}

/** A person who signed up through auth (so a session of theirs exists), acting through the own resolver. */
async function signedUpHolder(name: string) {
  const runtime = await started;
  const admin = createLocalClient(runtime, { principal: testOperator(), tenant: 'acme' });
  const base = { transport: 'test', headers: { 'x-tenant': runtime.tenants.acme.id } };
  const request = (action: string, input: unknown, headers: Record<string, string> = {}) =>
    runtime.invoker.invoke({
      action,
      input,
      carrier: { ...base, headers: { ...base.headers, ...headers } },
      requestId: crypto.randomUUID(),
      signal: new AbortController().signal,
    });
  const person = freshPerson(name);
  expect((await request('auth.signUp', person)).ok).toBe(true);
  const login = await request('auth.login', credentialsOf(person));
  if (!login.ok) throw login.error;
  const { sessionToken } = login.value as { sessionToken: string };
  const me = await request('auth.whoami', {}, { authorization: `Bearer ${sessionToken}` });
  if (!me.ok) throw me.error;
  const profileId = String((me.value as { subject: string }).subject);
  return holderOf(runtime, admin, profileId);
}

describe('a principal of an app own resolver that names a deactivated profile', () => {
  test('is refused at a request from the commit of the deactivation', async () => {
    const { atTenant, whoami, deactivate } = await holderOfProfile('refused');
    expect((await whoami(atTenant)).ok).toBe(true);
    await deactivate();
    const refused = await whoami(atTenant);
    expect(refused.ok ? undefined : refused.error).toMatchObject({
      kind: 'unauthenticated',
      message: 'The credentials were not accepted.',
    });
  });

  test('keeps its open stream through the deactivation: the resolver names no row of the profile', async () => {
    const { runtime, atTenant, deactivate } = await signedUpHolder('streamed');
    const abort = new AbortController();
    const iterator = runtime.invoker
      .subscribe<unknown, unknown>({
        action: 'auth.sessionEvents',
        input: {},
        carrier: atTenant,
        requestId: crypto.randomUUID(),
        signal: abort.signal,
      })
      [Symbol.asyncIterator]();
    expect((await iterator.next()).done).toBe(false);
    await deactivate();
    // The revocation jobs revoke the person's session, a change the stream follows: it arrives as a
    // frame on the stream that the deactivation did not end. An ended stream ends this loop with its error.
    await settleReactions(dispatcher, runtime.drainJobs);
    let frame: unknown;
    do {
      const step = await iterator.next();
      expect(step.done).toBe(false);
      frame = step.value;
    } while (JSON.stringify(frame).includes('revoked') === false);
    abort.abort();
  }, 60_000);

  test('is refused when its session is next checked: the revalidation the hub runs', async () => {
    const { runtime, atTenant, deactivate } = await holderOfProfile('checked');
    const opened = await runtime.invoker.open(atTenant);
    if (!opened.ok) throw opened.error;
    await deactivate();
    const checked = await opened.value.revalidate();
    expect(checked.ok ? undefined : (checked.error as KeelwerkError).kind).toBe('unauthenticated');
  });

  test('cannot redeem a stream ticket issued before the deactivation: core.ticket_invalid', async () => {
    const { runtime, atTenant, deactivate } = await holderOfProfile('ticketed');
    const issued = await runtime.invoker.invoke({
      action: 'live.ticket',
      input: { action: 'auth.sessionEvents' },
      carrier: atTenant,
      requestId: crypto.randomUUID(),
      signal: new AbortController().signal,
    });
    if (!issued.ok) throw issued.error;
    const { ticket } = issued.value as { ticket: string };
    await deactivate();
    const abort = new AbortController();
    const iterator = runtime.invoker
      .subscribe<unknown, unknown>({
        action: 'auth.sessionEvents',
        input: {},
        carrier: {
          transport: 'test',
          headers: { 'x-tenant': runtime.tenants.acme.id },
          ticket: { value: ticket, endpoint: 'subscribe', action: 'auth.sessionEvents' },
        },
        requestId: crypto.randomUUID(),
        signal: abort.signal,
      })
      [Symbol.asyncIterator]();
    const refused = await iterator.next().then(
      () => undefined,
      (error: KeelwerkError) => error,
    );
    abort.abort();
    expect(refused).toMatchObject({ kind: 'unauthenticated', code: 'core.ticket_invalid' });
  });

  test('is judged only in the tenant that holds the profile', async () => {
    const { atTenant, atOtherTenant, whoami, deactivate } = await holderOfProfile('elsewhere');
    await deactivate();
    expect((await whoami(atTenant)).ok).toBe(false);
    expect((await whoami(atOtherTenant)).ok).toBe(true);
  });

  test('is not judged at a scope without a tenant', async () => {
    const { atBackend, atTenant, runtime, deactivate } = await holderOfProfile('backend');
    await deactivate();
    expect((await runtime.invoker.open(atTenant)).ok).toBe(false);
    const opened = await runtime.invoker.open(atBackend);
    if (!opened.ok) throw opened.error;
    expect(opened.value.principal.scope.tenant).toBeNull();
  });
});
