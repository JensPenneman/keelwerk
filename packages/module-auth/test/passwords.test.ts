import { type Id, parseSealedValueText } from '@keelwerk/core';
import { testOperator } from '@keelwerk/testing';
import { describe, expect, onTestFinished, test } from 'vitest';
import { ada, asBearer, codeOf, signIn, whoami } from './support/auth-calls.ts';
import type { StorageKind } from './support/boot-auth.ts';
import { type BootedBoth, bootBoth } from './support/boot-both.ts';

const operator = testOperator();
const fresh = 'a brand new password 42';

describe.each(['memory', 'pglite'] as const)(
  'passwords with accounts on %s',
  (kind: StorageKind) => {
    const timeout = kind === 'pglite' ? 60_000 : 10_000;

    async function boot(): Promise<BootedBoth> {
      const both = await bootBoth(kind);
      onTestFinished(() => both.runtime.stop());
      const done = await both.request('auth.signUp', ada);
      if (!done.ok) throw done.error;
      return both;
    }

    const profileIdOf = async (both: BootedBoth) =>
      String((await both.rows('accounts.profile'))[0]?.id) as Id<'accounts.profile'>;

    const resetLink = async (both: BootedBoth): Promise<string> => {
      const issued = await both
        .client(operator)
        .invoke('auth.issueResetLink', { identifier: ada.identifier });
      return issued.token;
    };

    test('changePassword with the current password revokes the other sessions and rotates this one', {
      timeout,
    }, async () => {
      const both = await boot();
      const mine = await signIn(both);
      const other = await signIn(both);
      both.clock.advance({ minutes: 30 });
      const id = await profileIdOf(both);
      const headers = asBearer(mine.sessionToken);
      const refused = await both.request(
        'accounts.profile.changePassword',
        { id, newPassword: fresh },
        { headers },
      );
      expect(codeOf(refused)).toBe('auth.reauthentication_required');
      const before = (await both.rows('auth.credential', { sealed: true }))[0]?.verifier;
      const sealed = parseSealedValueText(String(before));
      if (sealed === undefined) throw new Error('the old verifier is not sealed');
      expect(await both.inUnit((unit) => unit.keys.openValue(sealed))).toBeDefined();
      const done = await both.request(
        'accounts.profile.changePassword',
        { id, currentPassword: ada.password, newPassword: fresh },
        { headers },
      );
      if (!done.ok) throw done.error;
      const rotated = done.value as { sessionToken: string; sessionId: string };
      expect(rotated.sessionToken).toEqual(expect.any(String));
      expect(codeOf(await whoami(both, headers))).toBe('core.unauthenticated');
      expect(codeOf(await whoami(both, asBearer(other.sessionToken)))).toBe('core.unauthenticated');
      expect((await whoami(both, asBearer(rotated.sessionToken))).ok).toBe(true);
      const sessions = await both.rows('auth.session');
      const next = sessions.find((row) => row.id === rotated.sessionId);
      expect(next?.rotatedFrom).toBe(mine.sessionId);
      expect(next?.revokedAt ?? null).toBeNull();
      expect(JSON.stringify(sessions)).not.toContain(rotated.sessionToken);
      expect(codeOf(await both.request('auth.login', ada))).toBe('auth.invalid_credentials');
      expect((await both.request('auth.login', { ...ada, password: fresh })).ok).toBe(true);
      // the old hash is sealed under a key that is destroyed with the change
      expect(await both.inUnit((unit) => unit.keys.openValue(sealed))).toBeUndefined();
    });

    test('a replayed changePassword conflicts and its receipt holds no token', {
      timeout,
    }, async () => {
      const both = await boot();
      const mine = await signIn(both);
      const id = await profileIdOf(both);
      const headers = asBearer(mine.sessionToken);
      const commandId = crypto.randomUUID();
      const first = await both.request(
        'accounts.profile.changePassword',
        { id, currentPassword: ada.password, newPassword: fresh },
        { headers, commandId },
      );
      if (!first.ok) throw first.error;
      const { sessionToken } = first.value as { sessionToken: string };
      const replay = await both.request(
        'accounts.profile.changePassword',
        { id, currentPassword: fresh, newPassword: fresh },
        { headers: asBearer(sessionToken), commandId },
      );
      expect(replay.ok ? undefined : replay.error.kind).toBe('conflict');
      expect(JSON.stringify(replay)).not.toContain(sessionToken);
      const receipt = await both.inUnit((unit) => unit.receipts.get(commandId));
      expect(receipt).toMatchObject({
        action: 'accounts.profile.changePassword',
        status: 'completed',
      });
      expect(JSON.stringify(receipt)).not.toContain(sessionToken);
      expect(JSON.stringify(receipt)).not.toContain(sessionToken.split('_')[2] ?? sessionToken);
    });

    test('a wrong current password is refused even in a recently authenticated session', {
      timeout,
    }, async () => {
      const both = await boot();
      const mine = await signIn(both);
      const id = await profileIdOf(both);
      const refused = await both.request(
        'accounts.profile.changePassword',
        { id, currentPassword: 'not the password', newPassword: fresh },
        { headers: asBearer(mine.sessionToken) },
      );
      expect(codeOf(refused)).toBe('auth.invalid_credentials');
      expect((await both.request('auth.login', ada)).ok).toBe(true);
      expect(codeOf(await both.request('auth.login', { ...ada, password: fresh }))).toBe(
        'auth.invalid_credentials',
      );
      expect((await whoami(both, asBearer(mine.sessionToken))).ok).toBe(true);
    });

    test('changing the password retires the open reset links', { timeout }, async () => {
      const both = await boot();
      const mine = await signIn(both);
      const link = await resetLink(both);
      const id = await profileIdOf(both);
      const done = await both.request(
        'accounts.profile.changePassword',
        { id, newPassword: fresh },
        { headers: asBearer(mine.sessionToken) },
      );
      expect(done.ok).toBe(true);
      expect(
        codeOf(
          await both.request('auth.resetPassword', { token: link, newPassword: 'x'.repeat(14) }),
        ),
      ).toBe('auth.reset_token_invalid');
    });

    test('a recent authentication replaces the current password, and so does reauthenticate', {
      timeout,
    }, async () => {
      const both = await boot();
      const mine = await signIn(both);
      const headers = asBearer(mine.sessionToken);
      const id = await profileIdOf(both);
      expect(
        (
          await both.request(
            'accounts.profile.changePassword',
            { id, newPassword: fresh },
            { headers },
          )
        ).ok,
      ).toBe(true);
      both.clock.advance({ minutes: 30 });
      const login = await both.request('auth.login', { ...ada, password: fresh });
      if (!login.ok) throw login.error;
      const session = login.value as { sessionToken: string };
      const later = asBearer(session.sessionToken);
      both.clock.advance({ minutes: 30 });
      const again = (password: string) =>
        both.request(
          'accounts.profile.changePassword',
          { id, newPassword: password },
          { headers: later },
        );
      expect(codeOf(await again('another password 43'))).toBe('auth.reauthentication_required');
      expect(
        codeOf(
          await both.request('auth.reauthenticate', { password: 'wrong' }, { headers: later }),
        ),
      ).toBe('auth.invalid_credentials');
      expect(
        (await both.request('auth.reauthenticate', { password: fresh }, { headers: later })).ok,
      ).toBe(true);
      expect((await again('another password 43')).ok).toBe(true);
    });

    test('another profile may not change the password', { timeout }, async () => {
      const both = await boot();
      const mine = await signIn(both);
      const other = (await both.client(operator).invoke('accounts.register', {
        displayName: 'Grace',
        email: 'grace@example.org',
      })) as { profileId: Id<'accounts.profile'> };
      const done = await both.request(
        'accounts.profile.changePassword',
        { id: other.profileId, currentPassword: ada.password, newPassword: fresh },
        { headers: asBearer(mine.sessionToken) },
      );
      expect(done.ok).toBe(false);
    });
  },
);
