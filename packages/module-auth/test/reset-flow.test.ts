import { testOperator } from '@keelwerk/testing';
import { describe, expect, onTestFinished, test } from 'vitest';
import { ada, asBearer, codeOf, grace, signIn, whoami } from './support/auth-calls.ts';
import type { StorageKind } from './support/boot-auth.ts';
import { type BootedBoth, bootBoth } from './support/boot-both.ts';
import { delivered } from './support/mailbox/delivered.ts';

const operator = testOperator();
const fresh = 'a brand new password 42';
const invalid = 'auth.reset_token_invalid';

describe.each(['memory', 'pglite'] as const)('reset links on %s', (kind: StorageKind) => {
  const timeout = kind === 'pglite' ? 60_000 : 10_000;

  async function boot(): Promise<BootedBoth> {
    delivered.length = 0;
    const both = await bootBoth(kind);
    onTestFinished(() => both.runtime.stop());
    const done = await both.request('auth.signUp', ada);
    if (!done.ok) throw done.error;
    return both;
  }

  const resetLink = async (both: BootedBoth): Promise<string> =>
    (await both.client(operator).invoke('auth.issueResetLink', { identifier: ada.identifier }))
      .token;

  const reset = (both: BootedBoth, token: string, newPassword = fresh) =>
    both.request('auth.resetPassword', { token, newPassword });

  test('a link works once and revokes every session', { timeout }, async () => {
    const both = await boot();
    const session = await signIn(both);
    const link = await resetLink(both);
    expect((await reset(both, link)).ok).toBe(true);
    expect(codeOf(await reset(both, link))).toBe(invalid);
    expect(codeOf(await whoami(both, asBearer(session.sessionToken)))).toBe('core.unauthenticated');
    expect((await both.request('auth.login', { ...ada, password: fresh })).ok).toBe(true);
    expect(JSON.stringify(await both.rows('auth.resetToken'))).not.toContain(link);
  });

  test('a link lasts 30 minutes: 29:59 succeeds, 30:00 fails', { timeout }, async () => {
    const both = await boot();
    const done = await both.request('auth.signUp', grace);
    if (!done.ok) throw done.error;
    // the 30:00 link belongs to another credential, so the reset of Ada's link does not retire it
    const expired = (
      await both.client(operator).invoke('auth.issueResetLink', { identifier: grace.identifier })
    ).token;
    const last = await resetLink(both);
    both.clock.advance({ minutes: 29, seconds: 59 });
    expect((await reset(both, last)).ok).toBe(true);
    both.clock.advance({ seconds: 1 });
    const open = (await both.rows('auth.resetToken')).filter(
      (row) => (row.usedAt ?? null) === null,
    );
    expect(open).toHaveLength(1);
    expect(codeOf(await reset(both, expired))).toBe(invalid);
  });

  test('a reset retires every other open link of the credential', { timeout }, async () => {
    const both = await boot();
    const first = await resetLink(both);
    const second = await resetLink(both);
    expect((await reset(both, first)).ok).toBe(true);
    expect(codeOf(await reset(both, second, 'yet another password 44'))).toBe(invalid);
    const rows = await both.rows('auth.resetToken');
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.usedAt !== undefined)).toBe(true);
    expect((await both.request('auth.login', { ...ada, password: fresh })).ok).toBe(true);
  });

  test('a forged token is invalid', { timeout }, async () => {
    const both = await boot();
    const token = await resetLink(both);
    for (const forged of ['nonsense', `${token}x`, token.slice(0, -2)]) {
      expect(codeOf(await reset(both, forged))).toBe(invalid);
    }
  });

  test('a known identifier stores one token and an unknown one none, with the same answer', {
    timeout,
  }, async () => {
    const both = await boot();
    const unknown = await both.request('auth.requestPasswordReset', {
      identifier: 'nobody@example.org',
    });
    expect(await both.rows('auth.resetToken')).toHaveLength(0);
    expect(delivered).toHaveLength(0);
    const known = await both.request('auth.requestPasswordReset', { identifier: ada.identifier });
    expect(known).toEqual(unknown);
    expect(known.ok).toBe(true);
    expect(JSON.stringify(known)).not.toContain('auth_');
    expect(await both.rows('auth.resetToken')).toHaveLength(1);
  });

  test('the token a delivery filler receives resets the password', { timeout }, async () => {
    const both = await boot();
    await both.request('auth.requestPasswordReset', { identifier: ada.identifier });
    await both.request('auth.requestPasswordReset', { identifier: 'nobody@example.org' });
    expect(delivered).toHaveLength(1);
    const [message] = delivered;
    expect(message?.identifier).toBe(ada.identifier);
    expect(message?.expiresAt.toString()).toBe(both.clock.now().add({ minutes: 30 }).toString());
    expect(JSON.stringify(await both.rows('auth.resetToken'))).not.toContain(message?.token ?? '-');
    expect((await reset(both, message?.token ?? '')).ok).toBe(true);
    expect((await both.request('auth.login', { ...ada, password: fresh })).ok).toBe(true);
  });
});
