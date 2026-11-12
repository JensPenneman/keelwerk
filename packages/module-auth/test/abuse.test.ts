import { describe, expect, onTestFinished, test } from 'vitest';
import { ada, codeOf, enrol } from './support/auth-calls.ts';
import { type BootedAuth, bootAuth, type StorageKind } from './support/boot-auth.ts';

describe.each(['memory', 'pglite'] as const)('auth abuse limits on %s', (kind: StorageKind) => {
  const timeout = kind === 'pglite' ? 60_000 : 10_000;

  async function boot(config: Readonly<Record<string, unknown>> = {}): Promise<BootedAuth> {
    const auth = await bootAuth(kind, config);
    onTestFinished(() => auth.runtime.stop());
    return auth;
  }

  const attempt = (auth: BootedAuth, name: string, address: string) =>
    auth.request(
      'auth.login',
      { identifier: `${name}@example.org`, password: 'nothing' },
      { address },
    );

  test('ten attempts per minute per address: the eleventh is rate_limited, another address is not', {
    timeout,
  }, async () => {
    const auth = await boot();
    for (let index = 0; index < 10; index += 1) {
      expect(codeOf(await attempt(auth, `user${index}`, '203.0.113.7'))).toBe(
        'auth.invalid_credentials',
      );
    }
    const refused = await attempt(auth, 'user10', '203.0.113.7');
    expect(codeOf(refused)).toBe('core.rate_limited');
    expect(refused.ok ? 0 : refused.error.retryAfter).toBeGreaterThan(0);
    expect(codeOf(await attempt(auth, 'user10', '203.0.113.8'))).toBe('auth.invalid_credentials');
    auth.clock.advance({ seconds: 7 });
    expect(codeOf(await attempt(auth, 'user11', '203.0.113.7'))).toBe('auth.invalid_credentials');
  });

  test('IPv6 addresses of one /64 share the address bucket', { timeout }, async () => {
    const auth = await boot({ addressAttemptsPerMinute: 2 });
    expect(codeOf(await attempt(auth, 'a', '2001:db8:1:2::1'))).toBe('auth.invalid_credentials');
    expect(codeOf(await attempt(auth, 'b', '2001:db8:1:2:ffff::9'))).toBe(
      'auth.invalid_credentials',
    );
    expect(codeOf(await attempt(auth, 'c', '2001:db8:1:2:1:2:3:4'))).toBe('core.rate_limited');
    expect(codeOf(await attempt(auth, 'd', '2001:db8:1:3::1'))).toBe('auth.invalid_credentials');
  });

  test('sign-up shares the address limit', { timeout }, async () => {
    const auth = await boot({ addressAttemptsPerMinute: 2 });
    const signUp = (name: string) =>
      auth.request(
        'auth.signUp',
        { identifier: `${name}@example.org`, password: 'a long enough password' },
        { address: '198.51.100.1' },
      );
    expect((await signUp('one')).ok).toBe(true);
    expect((await signUp('two')).ok).toBe(true);
    expect(codeOf(await signUp('three'))).toBe('core.rate_limited');
  });

  test('a carrier without a connection shares one address bucket: logins across many identifiers hit the limit', {
    timeout,
  }, async () => {
    const auth = await boot({ addressAttemptsPerMinute: 3 });
    const attemptWithout = (name: string) =>
      auth.request(
        'auth.login',
        { identifier: `${name}@example.org`, password: 'nothing' },
        { address: null },
      );
    for (const name of ['a', 'b', 'c']) {
      expect(codeOf(await attemptWithout(name))).toBe('auth.invalid_credentials');
    }
    expect(codeOf(await attemptWithout('d'))).toBe('core.rate_limited');
    // A carrier that has an address is not in that bucket.
    expect(codeOf(await attempt(auth, 'e', '203.0.113.7'))).toBe('auth.invalid_credentials');
  });

  test('five failed attempts per fifteen minutes per identifier: the sixth is refused, even with the right password', {
    timeout,
  }, async () => {
    const auth = await boot();
    await enrol(auth);
    for (let index = 0; index < 5; index += 1) {
      expect(codeOf(await auth.request('auth.login', { ...ada, password: 'wrong' }))).toBe(
        'auth.invalid_credentials',
      );
    }
    expect(codeOf(await auth.request('auth.login', ada))).toBe('core.rate_limited');
    // the same identifier in another case shares the bucket; a different identifier is unaffected
    expect(
      codeOf(await auth.request('auth.login', { ...ada, identifier: 'ADA@example.org' })),
    ).toBe('core.rate_limited');
    expect(
      codeOf(await auth.request('auth.login', { identifier: 'grace@example.org', password: 'x' })),
    ).toBe('auth.invalid_credentials');
    auth.clock.advance({ minutes: 4 });
    expect((await auth.request('auth.login', ada)).ok).toBe(true);
  });

  test('successful logins do not use the failure budget of an identifier', {
    timeout,
  }, async () => {
    const auth = await boot();
    await enrol(auth);
    for (let index = 0; index < 8; index += 1) {
      expect((await auth.request('auth.login', ada)).ok).toBe(true);
    }
  });

  test('spellings of one identifier share one failure bucket: NFC and NFD, Unicode and punycode', {
    timeout,
  }, async () => {
    const auth = await boot({ identifierFailedAttempts: 2 });
    const fail = (identifier: string) =>
      auth.request('auth.login', { identifier, password: 'wrong' });
    expect(codeOf(await fail('ren\u00e9@exämple.org'))).toBe('auth.invalid_credentials');
    expect(codeOf(await fail('rene\u0301@xn--exmple-cua.org'))).toBe('auth.invalid_credentials');
    expect(codeOf(await fail('RENÉ@EXÄMPLE.ORG'))).toBe('core.rate_limited');
  });

  test('the limits are configuration', { timeout }, async () => {
    const auth = await boot({ identifierFailedAttempts: 1 });
    await enrol(auth);
    expect(codeOf(await auth.request('auth.login', { ...ada, password: 'wrong' }))).toBe(
      'auth.invalid_credentials',
    );
    expect(codeOf(await auth.request('auth.login', ada))).toBe('core.rate_limited');
  });
});
