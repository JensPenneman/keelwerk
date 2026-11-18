import type { Carrier, PrincipalResolver, Scope } from '@keelwerk/core';
import { describe, expect, onTestFinished, test } from 'vitest';
import { principalResolversFill } from '../src/contributions/to-core/fills/principal-resolvers.ts';
import { asBearer, codeOf, enrol, signIn, whoami } from './support/auth-calls.ts';
import { type BootedAuth, bootAuth, type StorageKind } from './support/boot-auth.ts';
import { holdJobs } from './support/hold-jobs.ts';

describe.each(['memory', 'pglite'] as const)('the sliding session on %s', (kind: StorageKind) => {
  const timeout = kind === 'pglite' ? 60_000 : 10_000;

  async function boot(): Promise<BootedAuth> {
    const auth = await bootAuth(kind);
    onTestFinished(() => auth.runtime.stop());
    return auth;
  }

  const sessionRow = async (auth: BootedAuth, id: string) => {
    const rows = await auth.inUnit(
      async (unit) => {
        const descriptor = auth.runtime.app.registry.entities.get('auth.session')?.descriptor;
        if (descriptor === undefined) throw new Error('no auth.session');
        return (await unit.rows.find(descriptor, { select: Object.keys(descriptor.fields) })).rows;
      },
      { sealed: true },
    );
    const row = rows.find((one) => one.id === id);
    if (row === undefined) throw new Error('no such session');
    return row;
  };

  test('a session used after five minutes slides its idle expiry when the job runs', {
    timeout,
  }, async () => {
    const auth = await boot();
    await enrol(auth);
    const { sessionToken, sessionId } = await signIn(auth);
    const before = String((await sessionRow(auth, sessionId)).idleExpiresAt);
    auth.clock.advance({ hours: 11 });
    expect((await whoami(auth, asBearer(sessionToken))).ok).toBe(true);
    await auth.settle();
    const row = await sessionRow(auth, sessionId);
    expect(String(row.lastSeenAt)).toBe(auth.clock.now().toString());
    expect(String(row.idleExpiresAt)).toBe(auth.clock.now().add({ hours: 12 }).toString());
    expect(String(row.idleExpiresAt) > before).toBe(true);
    // The session is alive past its first idle expiry because it slid.
    auth.clock.advance({ hours: 2 });
    expect((await whoami(auth, asBearer(sessionToken))).ok).toBe(true);
  });

  test('a session used again within five minutes enqueues nothing', { timeout }, async () => {
    const auth = await boot();
    await enrol(auth);
    const { sessionToken, sessionId } = await signIn(auth);
    auth.clock.advance({ minutes: 6 });
    await whoami(auth, asBearer(sessionToken));
    await auth.settle();
    const slid = String((await sessionRow(auth, sessionId)).lastSeenAt);
    auth.clock.advance({ minutes: 4 });
    await whoami(auth, asBearer(sessionToken));
    await auth.settle();
    expect(String((await sessionRow(auth, sessionId)).lastSeenAt)).toBe(slid);
  });

  const rowsOf = async (auth: BootedAuth, entity: string) =>
    auth.inUnit(
      async (unit) => {
        const descriptor = auth.runtime.app.registry.entities.get(entity)?.descriptor;
        if (descriptor === undefined) throw new Error(`no ${entity}`);
        return (await unit.rows.find(descriptor, { select: Object.keys(descriptor.fields) })).rows;
      },
      { sealed: true },
    );

  test('the extension job of a session revoked before it runs succeeds having decided nothing', {
    timeout,
  }, async () => {
    const auth = await boot();
    await enrol(auth);
    const mine = await signIn(auth);
    const other = await signIn(auth);
    const held = holdJobs(auth.runtime.adapter);
    auth.clock.advance({ minutes: 6 });
    await whoami(auth, asBearer(mine.sessionToken));
    const before = await sessionRow(auth, mine.sessionId);
    const revoked = await auth.request(
      'auth.session.revoke',
      { id: mine.sessionId },
      { headers: asBearer(other.sessionToken) },
    );
    expect(revoked.ok).toBe(true);
    held.release();
    await auth.settle();
    // The job of `mine` ran as the module's own principal and judged the session itself (the other
    // session's request queued its own): no failed job is left behind.
    expect(held.outcomes.map((outcome) => outcome.kind)).toEqual(['succeeded', 'succeeded']);
    const after = await sessionRow(auth, mine.sessionId);
    expect(String(after.idleExpiresAt)).toBe(String(before.idleExpiresAt));
    expect(String(after.lastSeenAt)).toBe(String(before.lastSeenAt));
    expect(codeOf(await whoami(auth, asBearer(mine.sessionToken)))).toBe('core.unauthenticated');
  });

  test('a logout after a due request, and the revocation of a credential, leave no failed job', {
    timeout,
  }, async () => {
    const auth = await boot();
    await enrol(auth);
    const first = await signIn(auth);
    const second = await signIn(auth);
    const held = holdJobs(auth.runtime.adapter);
    auth.clock.advance({ minutes: 6 });
    await whoami(auth, asBearer(first.sessionToken));
    await whoami(auth, asBearer(second.sessionToken));
    const loggedOut = await auth.request(
      'auth.logout',
      {},
      { headers: asBearer(first.sessionToken) },
    );
    expect(loggedOut.ok).toBe(true);
    const credential = String((await rowsOf(auth, 'auth.credential'))[0]?.id);
    const revoked = await auth.request(
      'auth.credential.revoke',
      { id: credential },
      { headers: asBearer(second.sessionToken) },
    );
    expect(revoked.ok).toBe(true);
    held.release();
    await auth.settle();
    expect(held.outcomes.length).toBeGreaterThan(0);
    expect(held.outcomes.every((outcome) => outcome.kind === 'succeeded')).toBe(true);
  });

  test('a job that runs late extends from the request it was queued for, not from the time it runs', {
    timeout,
  }, async () => {
    const auth = await boot();
    await enrol(auth);
    const { sessionToken, sessionId } = await signIn(auth);
    const held = holdJobs(auth.runtime.adapter);
    auth.clock.advance({ minutes: 6 });
    const requested = auth.clock.now();
    expect((await whoami(auth, asBearer(sessionToken))).ok).toBe(true);
    // A backlog: the worker gets to the job eleven hours later, inside the first idle window.
    auth.clock.advance({ hours: 11 });
    held.release();
    await auth.settle();
    const row = await sessionRow(auth, sessionId);
    expect(String(row.lastSeenAt)).toBe(requested.toString());
    expect(String(row.idleExpiresAt)).toBe(requested.add({ hours: 12 }).toString());
  });

  /**
   * Queues an extension job as a 0.1.0 deployment kept it (no worker ran it): the command queue, the
   * reference of the session as its resolver stored it (resolver, principal id, credential id,
   * session id), the key `auth.extend:<session id>`, and an input of the session id alone.
   */
  const queueExtension = async (
    auth: BootedAuth,
    sessionId: string,
    input: Record<string, unknown>,
  ): Promise<void> => {
    const row = await sessionRow(auth, sessionId);
    await auth.inUnit((unit) =>
      unit.jobs.enqueue({
        kind: 'action',
        laneCap: 4,
        createdAt: auth.clock.now(),
        scope: {
          level: 'tenant',
          backendId: auth.runtime.backendId,
          tenantId: String(auth.runtime.tenants.acme?.id),
        },
        principal: {
          resolver: 'auth.session',
          principalId: sessionId,
          credentialId: String(row.credentialId),
          sessionId,
        } as never,
        causation: { actor: { kind: 'user', id: String(row.subject), via: 'auth.session' } },
        build: { id: 'development', revision: 1 },
        queue: 'commands',
        run: { action: 'auth.extendSession', input },
        key: { value: `auth.extend:${sessionId}`, onConflict: 'keep' },
      }),
    );
  };

  test('a job never moves the idle expiry or lastSeenAt backwards', { timeout }, async () => {
    const auth = await boot();
    await enrol(auth);
    const { sessionId } = await signIn(auth);
    const before = await sessionRow(auth, sessionId);
    const held = holdJobs(auth.runtime.adapter);
    auth.clock.advance({ minutes: 6 });
    // An older request than the session's last use, as a server whose clock is behind queues it.
    await queueExtension(auth, sessionId, {
      sessionId,
      seenAt: auth.clock.now().subtract({ hours: 2 }).toString(),
    });
    held.release();
    await auth.settle();
    expect(held.outcomes.map((outcome) => outcome.kind)).toEqual(['succeeded']);
    const row = await sessionRow(auth, sessionId);
    expect(String(row.lastSeenAt)).toBe(String(before.lastSeenAt));
    expect(String(row.idleExpiresAt)).toBe(String(before.idleExpiresAt));
  });

  test('a pending extension row of 0.1.0 (no seenAt) decides nothing for a live session and fails for a revoked one', {
    timeout,
  }, async () => {
    const auth = await boot();
    await enrol(auth);
    const live = await signIn(auth);
    const doomed = await signIn(auth);
    const before = await sessionRow(auth, live.sessionId);
    const held = holdJobs(auth.runtime.adapter);
    // Revoked within the first minutes, so the request that does it queues no extension of its own.
    const revoked = await auth.request(
      'auth.session.revoke',
      { id: doomed.sessionId },
      { headers: asBearer(live.sessionToken) },
    );
    expect(revoked.ok).toBe(true);
    auth.clock.advance({ hours: 1 });
    await queueExtension(auth, live.sessionId, { sessionId: live.sessionId });
    await queueExtension(auth, doomed.sessionId, { sessionId: doomed.sessionId });
    held.release();
    await auth.settle();
    // The live session is not extended: a row with no instant of its request grants no idle time.
    const after = await sessionRow(auth, live.sessionId);
    expect(String(after.lastSeenAt)).toBe(String(before.lastSeenAt));
    expect(String(after.idleExpiresAt)).toBe(String(before.idleExpiresAt));
    // The revoked session no longer resolves, so its job ends without running: the outcome the worker records.
    expect(
      held.outcomes
        .map((outcome) => (outcome.kind === 'succeeded' ? 'succeeded' : outcome.error.code))
        .toSorted(),
    ).toEqual(['core.unauthenticated', 'succeeded']);
    // It ends as a failed job (history only): the job names no dead letter, so none is listed.
    expect(held.outcomes.map((outcome) => outcome.kind).toSorted()).toEqual([
      'failed',
      'succeeded',
    ]);
  });
});

/** What the session resolver answers, as far as these cases read it. */
interface Resolved {
  readonly renewCookie?: { readonly expiresAt: Temporal.Instant };
}

describe('the renewed cookie of a sliding session (S-110)', () => {
  const now = Temporal.Instant.from('2026-11-20T09:00:00Z');
  const scope: Scope = { level: 'tenant', backendId: 'b1', tenantId: 't1' };
  const token = `pss_${'a'.repeat(26)}_${'b'.repeat(52)}`;
  const absolute = now.add({ hours: 24 * 30 });

  /** A resolver over a stored session last seen `lastSeen` minutes ago, answering a carrier. */
  function resolution(lastSeen: number, carrier: Partial<Carrier>) {
    const row = {
      id: 'sess-1',
      subject: 'subject-1',
      credentialId: 'cred-1',
      tokenVerifier: 'v',
      lastSeenAt: now.subtract({ minutes: lastSeen }),
      idleExpiresAt: now.add({ hours: 1 }),
      absoluteExpiresAt: absolute,
    };
    const own = {
      config: { sessionIdleMinutes: 720 },
      load: {
        auth: {
          session: {
            *one(): Generator<{ kind: 'load' }, typeof row, unknown> {
              yield { kind: 'load' };
              return row;
            },
          },
          credential: {
            *byId(): Generator<{ kind: 'load' }, { id: string }, unknown> {
              yield { kind: 'load' };
              return { id: 'cred-1' };
            },
          },
        },
      },
      secrets: {
        *verify(): Generator<{ kind: 'verify' }, boolean, unknown> {
          yield { kind: 'verify' };
          return true;
        },
      },
    };
    const [resolver] = (
      principalResolversFill.factory as unknown as (o: never) => PrincipalResolver[]
    )(own as never);
    if (resolver === undefined) throw new Error('no resolver');
    const generator = resolver.resolve(
      { transport: 'http', ...carrier },
      { scope, clock: { now: () => now } },
    ) as unknown as Generator<unknown, Resolved, unknown>;
    let step = generator.next();
    while (step.done !== true) step = generator.next();
    return step.value;
  }

  const cookie = { headers: { cookie: `__Host-keelwerk_session=${token}` } };
  const bearer = { headers: { authorization: `Bearer ${token}` } };

  test('a cookie request whose extension is due answers a renewed cookie', () => {
    expect(resolution(6, cookie)).toMatchObject({
      renewCookie: {
        name: '__Host-keelwerk_session',
        value: token,
        expiresAt: now.add({ hours: 12 }),
      },
    });
  });

  test('a bearer request never does, nor a cookie request whose extension is not due', () => {
    expect(resolution(6, bearer)).not.toHaveProperty('renewCookie');
    expect(resolution(2, cookie)).not.toHaveProperty('renewCookie');
  });

  test('the renewed expiry never passes the absolute one', () => {
    const nearEnd = resolution(6, cookie);
    expect(nearEnd.renewCookie?.expiresAt.epochMilliseconds).toBeLessThanOrEqual(
      absolute.epochMilliseconds,
    );
  });
});
