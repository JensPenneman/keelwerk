import { describe, expect, onTestFinished, test } from 'vitest';
import {
  ada,
  asBearer,
  asCookie,
  codeOf,
  enrol,
  grace,
  probe,
  signIn,
  whoami,
} from './support/auth-calls.ts';
import { type BootedAuth, bootAuth, type StorageKind } from './support/boot-auth.ts';

describe.each(['memory', 'pglite'] as const)('auth sessions on %s', (kind: StorageKind) => {
  const timeout = kind === 'pglite' ? 60_000 : 10_000;

  async function boot(config: Readonly<Record<string, unknown>> = {}): Promise<BootedAuth> {
    const auth = await bootAuth(kind, config);
    onTestFinished(() => auth.runtime.stop());
    return auth;
  }

  test('an idle session expires: a cookie turns anonymous, a bearer token is unauthenticated', {
    timeout,
  }, async () => {
    const auth = await boot();
    await enrol(auth);
    const { sessionToken } = await signIn(auth);
    auth.clock.advance({ hours: 11 });
    expect((await whoami(auth, asBearer(sessionToken))).ok).toBe(true);
    auth.clock.advance({ hours: 2 });
    expect(codeOf(await whoami(auth, asBearer(sessionToken)))).toBe('core.unauthenticated');
    expect(codeOf(await probe(auth, asBearer(sessionToken)))).toBe('core.unauthenticated');
    expect(codeOf(await probe(auth, asCookie(sessionToken)))).toBe('auth.invalid_credentials');
  });

  test('the absolute lifetime caps the idle one', { timeout }, async () => {
    const auth = await boot({ sessionIdleMinutes: 5000, sessionAbsoluteDays: 1 });
    await enrol(auth);
    const session = await signIn(auth);
    expect(session.expiresAt.toString()).toBe(auth.clock.now().add({ hours: 24 }).toString());
    auth.clock.advance({ hours: 23 });
    expect((await whoami(auth, asBearer(session.sessionToken))).ok).toBe(true);
    auth.clock.advance({ hours: 2 });
    expect(codeOf(await probe(auth, asBearer(session.sessionToken)))).toBe('core.unauthenticated');
  });

  test('the resolver asks for the idle extension at most every five minutes, as one keyed job', {
    timeout,
  }, async () => {
    const auth = await boot();
    await enrol(auth);
    const { sessionToken } = await signIn(auth);
    const jobs = async () =>
      auth.inUnit(async (unit) => {
        const stats = await unit.jobs.stats('commands');
        return stats.reduce((total, row) => total + row.due, 0);
      });
    expect(await jobs()).toBe(0);
    auth.clock.advance({ minutes: 4 });
    await whoami(auth, asBearer(sessionToken));
    expect(await jobs()).toBe(0);
    auth.clock.advance({ minutes: 2 });
    await whoami(auth, asBearer(sessionToken));
    await whoami(auth, asCookie(sessionToken));
    expect(await jobs()).toBe(1);
  });

  test("a user revokes one of their own sessions, and nobody else's", { timeout }, async () => {
    const auth = await boot();
    await enrol(auth, ada);
    await enrol(auth, grace);
    const mine = await signIn(auth, ada);
    const other = await signIn(auth, ada);
    const hers = await signIn(auth, grace);
    const revoked = await auth.request(
      'auth.session.revoke',
      { id: other.sessionId },
      { headers: asCookie(mine.sessionToken) },
    );
    expect(revoked.ok).toBe(true);
    expect(codeOf(await probe(auth, asBearer(other.sessionToken)))).toBe('core.unauthenticated');
    expect((await whoami(auth, asBearer(mine.sessionToken))).ok).toBe(true);
    const foreign = await auth.request(
      'auth.session.revoke',
      { id: hers.sessionId },
      { headers: asCookie(mine.sessionToken) },
    );
    expect(foreign.ok).toBe(false);
    expect((await whoami(auth, asBearer(hers.sessionToken))).ok).toBe(true);
  });

  test('a revoked credential ends its sessions and refuses a new login', { timeout }, async () => {
    const auth = await boot();
    const credentialId = await enrol(auth);
    const session = await signIn(auth);
    const revoked = await auth.request(
      'auth.credential.revoke',
      { id: credentialId, reason: 'lost' },
      { headers: asBearer(session.sessionToken) },
    );
    expect(revoked.ok).toBe(true);
    expect(codeOf(await probe(auth, asBearer(session.sessionToken)))).toBe('core.unauthenticated');
    expect(codeOf(await auth.request('auth.login', ada))).toBe('auth.invalid_credentials');
    const again = await auth.request(
      'auth.credential.revoke',
      { id: credentialId },
      { headers: asCookie(session.sessionToken) },
    );
    expect(again.ok).toBe(false);
    // the identifier is free again for a new password credential
    expect(codeOf(await auth.request('auth.signUp', ada))).toBeUndefined();
  });

  test("a user reads their own credential's last use, and never the verifier", {
    timeout,
  }, async () => {
    const auth = await boot();
    const credentialId = await enrol(auth);
    const session = await signIn(auth);
    const got = await auth.request(
      'auth.credential.get',
      { ids: [credentialId] },
      { headers: asBearer(session.sessionToken) },
    );
    expect(got.ok).toBe(true);
    const row = got.ok ? (got.value as { list: Record<string, unknown>[] }).list[0] : undefined;
    expect(row).toHaveProperty('lastUsedAt');
    expect(row).not.toHaveProperty('verifier');
    await enrol(auth, grace);
    const hers = await signIn(auth, grace);
    const snoop = await auth.request(
      'auth.credential.get',
      { ids: [credentialId] },
      { headers: asBearer(hers.sessionToken) },
    );
    expect(snoop.ok ? (snoop.value as { list: unknown[] }).list : []).toEqual([]);
  });
});
