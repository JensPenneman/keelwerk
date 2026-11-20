import type { DataAdapter, ErasureRecord, JobOutcome, Unit } from '@keelwerk/core';
import { erasure } from '@keelwerk/events';
import { testOperator } from '@keelwerk/testing';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { type LocalPortal, startLocalPortal } from './support/local-portal.ts';
import { credentialsOf, freshPerson, sessionCookie } from './support/people.ts';

const operator = testOperator();
let now = Temporal.Instant.from('2026-11-12T09:00:00Z');
const clock = { now: () => now };

const asCookie = (token: string) => ({ cookie: `${sessionCookie}=${token}` });
const asBearer = (token: string) => ({ authorization: `Bearer ${token}` });

/** What a test of a portal reads and does, over one booted portal. */
function kitOf(portal: LocalPortal) {
  const { runtime } = portal;
  const scope = {
    level: 'tenant',
    backendId: runtime.backendId,
    tenantId: runtime.tenants.acme.id,
  } as const;
  const descriptor = (ref: string) => {
    const found = runtime.app.registry.entities.get(ref)?.descriptor;
    if (found === undefined) throw new Error(`the portal has no ${ref}`);
    return found;
  };
  const inTenant = <T>(fn: (unit: Unit) => Promise<T>) =>
    runtime.adapter.unit(runtime.namespace, scope, fn, { readOnly: true });
  return {
    inTenant,
    /** A person who signed up and logged in without a user agent or an address: the session holds no personal value. */
    async enrol(name: string) {
      const person = freshPerson(name);
      expect((await portal.request('auth.signUp', person)).ok).toBe(true);
      const login = await portal.request('auth.login', credentialsOf(person));
      if (!login.ok) throw login.error;
      const { sessionToken, sessionId } = login.value as {
        sessionToken: string;
        sessionId: string;
      };
      const whoami = await portal.request('auth.whoami', {}, { headers: asBearer(sessionToken) });
      if (!whoami.ok) throw whoami.error;
      const subject = String((whoami.value as { subject: string }).subject);
      const link = await portal
        .client(operator)
        .invoke('auth.issueResetLink', { identifier: person.identifier });
      return { sessionToken, sessionId, subject, resetToken: link.token };
    },
    /** The rows of an entity that name the subject, archived and erased ones included (the kernel's read). */
    rowsOfSubject: (ref: string, subject: string) =>
      inTenant(async (unit) =>
        (
          await unit.rows.find(descriptor(ref), {
            includeArchived: true,
            includeErased: true,
          })
        ).rows.filter((row) => row.subject === subject),
      ),
    receiptsOf: (principalId: string) =>
      inTenant(async (unit) =>
        (
          await unit.rows.find(descriptor('core.commandReceipt'), {
            where: { op: 'eq', field: 'principalId', value: principalId },
            includeArchived: true,
          })
        ).rows.filter((row) => row.action !== 'core.eraseSubject'),
      ),
    pendingJobs: () =>
      inTenant(async (unit) =>
        (await unit.jobs.stats()).reduce((sum, entry) => sum + entry.queued, 0),
      ),
    opened: (headers: Record<string, string>) =>
      runtime.invoker.open({
        transport: 'test',
        headers: { 'x-tenant': runtime.tenants.acme.id, ...headers },
      }),
  };
}

describe('the holder of a session of an erased subject (14.7.5, 17.2.4)', () => {
  const worker = erasure({ pollMs: 3_600_000 });
  let portal: LocalPortal;
  let kit: ReturnType<typeof kitOf>;

  beforeAll(async () => {
    portal = await startLocalPortal('pglite', { workers: true, eventWorkers: [worker], clock });
    kit = kitOf(portal);
  }, 120_000);

  afterAll(() => portal?.runtime.stop());

  test('after an operator erases the subject, the session does not resolve, its row is erased and its receipts are gone', {
    timeout: 180_000,
  }, async () => {
    const me = await kit.enrol('holder');
    // The session and the reset token hold no personal value, so no reference points at them.
    const referenced = await kit.inTenant((unit) => unit.keys.refs(me.subject, null, 100));
    expect(referenced.map((ref) => ref.type)).not.toContain('auth.session');
    expect(referenced.map((ref) => ref.type)).not.toContain('auth.resetToken');
    expect(await kit.rowsOfSubject('auth.session', me.subject)).toHaveLength(1);
    expect(await kit.rowsOfSubject('auth.resetToken', me.subject)).toHaveLength(1);
    // A command the session ran leaves a receipt whose principal is the session.
    const ran = await portal.request(
      'auth.extendSession',
      { sessionId: me.sessionId },
      { headers: asBearer(me.sessionToken), commandId: crypto.randomUUID() },
    );
    expect(ran.ok).toBe(true);
    expect((await kit.receiptsOf(me.sessionId)).length).toBeGreaterThan(0);
    const live = await kit.opened(asCookie(me.sessionToken));
    expect(live.ok && live.value.principal.kind).toBe('user');

    // A session that was revoked: the answer the erased one must equal.
    const other = await kit.enrol('revoked');
    const loggedOut = await portal.request(
      'auth.logout',
      {},
      { headers: asBearer(other.sessionToken) },
    );
    expect(loggedOut.ok).toBe(true);
    const revoked = await kit.opened(asBearer(other.sessionToken));

    const accepted = await portal.client(operator).invoke(
      'core.eraseSubject',
      { subjectId: me.subject as never, reason: 'operator' },
      {
        prefer: 'async',
      },
    );
    expect(accepted).toMatchObject({ status: 'accepted' });
    await portal.runtime.drainJobs();
    await worker.pass();
    await portal.runtime.drainJobs();

    for (const ref of ['auth.session', 'auth.resetToken']) {
      const [row, ...rest] = await kit.rowsOfSubject(ref, me.subject);
      expect(rest).toEqual([]);
      expect(row?.kwErasedAt).toBeDefined();
      expect(row?.archivedAt).toBeDefined();
    }
    const cookie = await kit.opened(asCookie(me.sessionToken));
    expect(cookie.ok && cookie.value.principal.kind).toBe('anonymous');
    expect(cookie.ok && cookie.value.clearCookies).toEqual([sessionCookie]);
    const bearer = await kit.opened(asBearer(me.sessionToken));
    expect(bearer.ok).toBe(false);
    expect(revoked.ok).toBe(false);
    if (!(bearer.ok || revoked.ok)) {
      expect(bearer.error).toMatchObject({ kind: 'unauthenticated' });
      expect(JSON.stringify(bearer.error)).toBe(JSON.stringify(revoked.error));
    }
    expect(await kit.receiptsOf(me.sessionId)).toEqual([]);
  });
});

describe('the idle extension a session has queued (17.2.3, 14.7.5)', () => {
  const worker = erasure({ pollMs: 3_600_000 });
  let portal: LocalPortal;
  let kit: ReturnType<typeof kitOf>;
  /** How the attempts of the timers queue ended, and whether the worker may take them yet. */
  const timers = { held: true, outcomes: [] as JobOutcome[] };

  beforeAll(async () => {
    portal = await startLocalPortal('pglite', {
      workers: { queues: ['timers'] },
      eventWorkers: [worker],
      clock,
    });
    kit = kitOf(portal);
    // The worker takes nothing until the test lets it, so the timer the resolver sets stays where it is.
    const adapter = portal.runtime.adapter as { unit: DataAdapter['unit'] };
    const inner = adapter.unit.bind(portal.runtime.adapter);
    adapter.unit = (namespace, scope, fn, options) =>
      inner(
        namespace,
        scope,
        (unit) =>
          fn({
            ...unit,
            jobs: {
              ...unit.jobs,
              take: (queue, workerId, request) =>
                timers.held
                  ? Promise.resolve({ jobs: [], skippedLanes: 1 })
                  : unit.jobs.take(queue, workerId, request),
              complete: (attempt, workerId, outcome) => {
                timers.outcomes.push(outcome);
                return unit.jobs.complete(attempt, workerId, outcome);
              },
            },
          }),
        options,
      );
  }, 120_000);

  afterAll(() => portal?.runtime.stop());

  test('is a timer of the module, so the erasure leaves it, and it decides nothing when it runs', {
    timeout: 180_000,
  }, async () => {
    const me = await kit.enrol('queued');
    // The creation hooks of the tenants are jobs too, and no worker takes their queue here: they stay.
    const others = await kit.pendingJobs();
    // A request after the extension interval asks for the idle extension: a timer of the module's
    // service principal, whose input holds the opaque session id and the instant of the request,
    // and whose causation names the user who made the request (the subject, as the actor).
    now = now.add({ minutes: 6 });
    const resolved = await portal.request(
      'auth.whoami',
      {},
      { headers: asCookie(me.sessionToken) },
    );
    expect(resolved.ok).toBe(true);
    expect(await kit.pendingJobs()).toBe(others + 1);
    // The erasure runs from the ledger alone. It purges the jobs of the subject's principals; this
    // timer belongs to the module's, so it stays, with the user's id as the actor that caused it
    // (a reference, no personal value).
    const record: ErasureRecord = {
      type: 'erasure',
      tenantId: portal.runtime.tenants.acme.id,
      subjectId: me.subject,
      recordedAt: now.toString(),
      requester: { kind: 'operator', id: null, via: 'core.operator' },
      reason: 'operator',
      commandId: crypto.randomUUID(),
    };
    await portal.runtime.control.adapter.unit(
      portal.runtime.control.namespace,
      { level: 'deployment' },
      async (unit) => unit.ledger?.append(record),
    );
    await worker.pass();
    expect(await kit.pendingJobs()).toBe(others + 1);
    const erased = await kit.rowsOfSubject('auth.session', me.subject);
    expect(erased[0]?.kwErasedAt).toBeDefined();
    // A worker runs the timer after the erasure: it succeeds, and the erased row stays as it was.
    timers.held = false;
    await portal.runtime.drainJobs();
    expect(timers.outcomes.map((outcome) => outcome.kind)).toEqual(['succeeded']);
    expect(await kit.pendingJobs()).toBe(others);
    expect(await kit.rowsOfSubject('auth.session', me.subject)).toEqual(erased);
  });
});
