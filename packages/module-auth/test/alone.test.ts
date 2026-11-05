import { deriveSurface } from '@keelwerk/core';
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
  subjectOf,
  whoami,
} from './support/auth-calls.ts';
import { type BootedAuth, bootAuth, type StorageKind } from './support/boot-auth.ts';

describe.each(['memory', 'pglite'] as const)('auth alone on %s', (kind: StorageKind) => {
  const timeout = kind === 'pglite' ? 60_000 : 10_000;

  async function boot(config: Readonly<Record<string, unknown>> = {}): Promise<BootedAuth> {
    const auth = await bootAuth(kind, config);
    onTestFinished(() => auth.runtime.stop());
    return auth;
  }

  test('sign-up answers a reference, and the same identifier is auth.identifier_taken whatever its case', {
    timeout,
  }, async () => {
    const auth = await boot();
    const credentialId = await enrol(auth);
    expect(credentialId).toEqual(expect.any(String));
    const again = await auth.request('auth.signUp', {
      identifier: 'ADA@Example.org',
      password: 'another password',
    });
    expect(codeOf(again)).toBe('auth.identifier_taken');
  });

  test('two concurrent sign-ups of one identifier: one succeeds, one is refused', {
    timeout,
  }, async () => {
    const auth = await boot();
    const answers = await Promise.all(
      ['one password', 'two password'].map((password) =>
        auth.request('auth.signUp', { identifier: ada.identifier, password }),
      ),
    );
    expect(answers.filter((answer) => answer.ok)).toHaveLength(1);
    expect(answers.filter((answer) => !answer.ok)).toHaveLength(1);
    const refused = answers.map(codeOf).find((code) => code !== undefined);
    expect(['auth.identifier_taken', 'core.conflict']).toContain(refused);
  });

  test('login opens a session; a wrong password and an unknown identifier fail alike', {
    timeout,
  }, async () => {
    const auth = await boot();
    await enrol(auth);
    const session = await signIn(auth);
    expect(session.sessionToken).toMatch(/^pss_[a-z2-7]{26}_[a-z2-7]{52}$/);
    expect(session.expiresAt.toString()).toBe(auth.clock.now().add({ hours: 12 }).toString());
    const wrong = await auth.request('auth.login', { ...ada, password: 'wrong' });
    const unknown = await auth.request('auth.login', {
      identifier: 'nobody@example.org',
      password: 'wrong',
    });
    expect(codeOf(wrong)).toBe('auth.invalid_credentials');
    expect(codeOf(unknown)).toBe('auth.invalid_credentials');
    expect(wrong.ok ? '' : wrong.error.message).toBe(unknown.ok ? '' : unknown.error.message);
  });

  test('an authenticated call passes through the session resolver by cookie and by bearer token', {
    timeout,
  }, async () => {
    const auth = await boot();
    await enrol(auth, ada);
    await enrol(auth, grace);
    const first = await signIn(auth, ada);
    const second = await signIn(auth, ada);
    const other = await signIn(auth, grace);
    expect(first.sessionToken).not.toBe(second.sessionToken);
    const subject = await subjectOf(auth, first);
    const byCookie = await whoami(auth, asCookie(second.sessionToken));
    expect(byCookie).toMatchObject({ ok: true, value: { subject } });
    expect(await subjectOf(auth, other)).not.toBe(subject);
    const anonymous = await whoami(auth, {});
    expect(anonymous.ok).toBe(false);
  });

  test('logout revokes the session: a cookie turns anonymous, a bearer token is unauthenticated', {
    timeout,
  }, async () => {
    const auth = await boot();
    await enrol(auth);
    const mine = await signIn(auth);
    const elsewhere = await signIn(auth);
    const done = await auth.request('auth.logout', {}, { headers: asCookie(mine.sessionToken) });
    expect(done.ok).toBe(true);
    const cookie = await whoami(auth, asCookie(mine.sessionToken));
    expect(codeOf(cookie)).toBe('core.unauthenticated');
    expect(codeOf(await probe(auth, asCookie(mine.sessionToken)))).toBe('auth.invalid_credentials');
    expect(codeOf(await probe(auth, asBearer(mine.sessionToken)))).toBe('core.unauthenticated');
    expect((await whoami(auth, asBearer(elsewhere.sessionToken))).ok).toBe(true);
  });

  test('the surface carries the cookie and CLI hints, and a revoked cookie is cleared', {
    timeout,
  }, async () => {
    const auth = await boot();
    const { surface } = deriveSurface(auth.runtime.app, auth.runtime.head);
    const hintsOf = (ref: string) => surface.actions.find((action) => action.ref === ref)?.hints;
    expect(hintsOf('auth.login')).toMatchObject({
      http: {
        cookie: {
          set: { name: '__Host-keelwerk_session' },
          omitFromBody: ['sessionToken'],
        },
      },
      cli: { login: { tokenField: 'sessionToken' } },
    });
    expect(hintsOf('auth.logout')).toMatchObject({
      http: { cookie: { clear: { name: '__Host-keelwerk_session' } } },
    });
    await enrol(auth);
    const mine = await signIn(auth);
    const carrier = (headers: Record<string, string>) => ({
      transport: 'test',
      headers: { 'x-tenant': auth.runtime.tenants.acme?.id ?? '', ...headers },
    });
    const live = await auth.runtime.invoker.open(carrier(asCookie(mine.sessionToken)));
    expect(live.ok ? live.value.clearCookies : 'refused').toBeUndefined();
    const done = await auth.request('auth.logout', {}, { headers: asCookie(mine.sessionToken) });
    expect(done.ok).toBe(true);
    const stale = await auth.runtime.invoker.open(carrier(asCookie(mine.sessionToken)));
    expect(stale.ok ? stale.value.clearCookies : 'refused').toEqual(['__Host-keelwerk_session']);
  });

  test('a token with the right public id and a wrong secret is not accepted', {
    timeout,
  }, async () => {
    const auth = await boot();
    await enrol(auth);
    const { sessionToken } = await signIn(auth);
    const forged = `${sessionToken.slice(0, -1)}${sessionToken.endsWith('a') ? 'b' : 'a'}`;
    expect(codeOf(await probe(auth, asBearer(forged)))).toBe('core.unauthenticated');
    expect(codeOf(await probe(auth, asBearer('garbage')))).toBe('core.unauthenticated');
    expect(codeOf(await probe(auth, asCookie(forged)))).toBe('auth.invalid_credentials');
    expect((await whoami(auth, asBearer(sessionToken))).ok).toBe(true);
  });

  test("a session is its tenant's: the same identifier in two tenants is two credentials", {
    timeout,
  }, async () => {
    const auth = await boot();
    await enrol(auth, ada, 'acme');
    await enrol(auth, grace, 'globex');
    const session = await signIn(auth, ada, 'acme');
    const elsewhere = await auth.request(
      'auth.whoami',
      {},
      { headers: asBearer(session.sessionToken), tenant: 'globex' },
    );
    expect(codeOf(elsewhere)).toBe('core.unauthenticated');
    expect(codeOf(await auth.request('auth.login', ada, { tenant: 'globex' }))).toBe(
      'auth.invalid_credentials',
    );
    expect(codeOf(await auth.request('auth.signUp', ada, { tenant: 'globex' }))).toBeUndefined();
  });
});
