import { testOperator } from '@keelwerk/testing';
import { describe, expect, onTestFinished, test } from 'vitest';
import { ada, asBearer, codeOf, signIn } from './support/auth-calls.ts';
import type { StorageKind } from './support/boot-auth.ts';
import { type BootedBoth, bootBoth } from './support/boot-both.ts';

const operator = testOperator();

describe.each(['memory', 'pglite'] as const)('password length on %s', (kind: StorageKind) => {
  const timeout = kind === 'pglite' ? 60_000 : 10_000;

  async function boot(minPasswordLength?: number): Promise<BootedBoth> {
    const both = await bootBoth(kind, {
      auth: minPasswordLength === undefined ? {} : { minPasswordLength },
    });
    onTestFinished(() => both.runtime.stop());
    return both;
  }

  const refusal = (outcome: Awaited<ReturnType<BootedBoth['request']>>) => {
    if (outcome.ok) throw new Error('the call succeeded');
    return outcome.error;
  };

  const profileIdOf = async (both: BootedBoth): Promise<string> =>
    String((await both.rows('accounts.profile'))[0]?.id);

  const resetLink = async (both: BootedBoth): Promise<string> =>
    (await both.client(operator).invoke('auth.issueResetLink', { identifier: ada.identifier }))
      .token;

  test('sign-up refuses a password shorter than 15 and names the field', { timeout }, async () => {
    const both = await boot();
    const error = refusal(
      await both.request('auth.signUp', { ...ada, password: 'only 14 chars!' }),
    );
    expect(error.code).toBe('core.validation');
    expect(error.message).toContain('at least 15');
    expect(error.issues?.[0]?.path).toEqual(['password']);
    expect((await both.request('auth.signUp', { ...ada, password: 'exactly 15 char' })).ok).toBe(
      true,
    );
  });

  test('a changed minimum applies to the message and to the boundary', { timeout }, async () => {
    const both = await boot(20);
    const short = refusal(
      await both.request('auth.signUp', { ...ada, password: 'nineteen chars long' }),
    );
    expect(short.message).toContain('at least 20');
    expect((await both.request('auth.signUp', { ...ada, password: 'a'.repeat(20) })).ok).toBe(true);
  });

  test('a password of more than 256 code points is refused, 256 passes', { timeout }, async () => {
    const both = await boot();
    const long = refusal(await both.request('auth.signUp', { ...ada, password: '😀'.repeat(257) }));
    expect(long.message).toContain('at most 256');
    expect((await both.request('auth.signUp', { ...ada, password: '😀'.repeat(256) })).ok).toBe(
      true,
    );
  });

  test('resetPassword checks the length before it spends the token', { timeout }, async () => {
    const both = await boot();
    expect((await both.request('auth.signUp', ada)).ok).toBe(true);
    const link = await resetLink(both);
    const error = refusal(
      await both.request('auth.resetPassword', { token: link, newPassword: 'short' }),
    );
    expect(error.code).toBe('core.validation');
    expect(error.message).toContain('at least 15');
    expect(error.issues?.[0]?.path).toEqual(['newPassword']);
    const good = await both.request('auth.resetPassword', {
      token: link,
      newPassword: 'a long enough password',
    });
    expect(good.ok).toBe(true);
  });

  test('changePassword refuses a short new password', { timeout }, async () => {
    const both = await boot();
    expect((await both.request('auth.signUp', ada)).ok).toBe(true);
    const session = await signIn(both);
    const error = refusal(
      await both.request(
        'accounts.profile.changePassword',
        { id: await profileIdOf(both), currentPassword: ada.password, newPassword: 'short' },
        { headers: asBearer(session.sessionToken) },
      ),
    );
    expect(error.code).toBe('core.validation');
    expect(error.issues?.[0]?.path).toEqual(['newPassword']);
  });

  test('a stored shorter password still logs in and re-authenticates', { timeout }, async () => {
    const both = await boot(8);
    const shorter = { ...ada, password: 'only ten c' };
    expect((await both.request('auth.signUp', shorter)).ok).toBe(true);
    const session = await signIn(both, shorter);
    const again = await both.request(
      'auth.reauthenticate',
      { password: shorter.password },
      { headers: asBearer(session.sessionToken) },
    );
    expect(codeOf(again)).toBeUndefined();
  });
});
