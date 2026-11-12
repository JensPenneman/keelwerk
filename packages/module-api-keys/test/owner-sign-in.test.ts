import { describe, expect, onTestFinished, test } from 'vitest';
import type { KeysStorage } from './support/boot-api-keys.ts';
import {
  type BootedOwnerApp,
  bootOwnerApp,
  enrolOwner,
  ownerPerson,
} from './support/boot-owner-app.ts';

const sessionOnlyReason = 'Only a person signed in with a session changes how they sign in.';
const fresh = 'a brand new password 42';

describe.each(['memory', 'pglite'] as const)(
  'a key and its owner sign-in on %s',
  (kind: KeysStorage) => {
    const timeout = kind === 'pglite' ? 60_000 : 10_000;

    /** Ada signs up, logs in twice and makes a write key with the first session. */
    async function boot() {
      const app: BootedOwnerApp = await bootOwnerApp(kind);
      onTestFinished(() => app.runtime.stop());
      const owner = await enrolOwner(app);
      const spare = await owner.login();
      return { app, ...owner, spare, profileId: await app.profileId() };
    }

    test('a write key is refused each command that changes how its owner signs in, with one reason', {
      timeout,
    }, async () => {
      const { app, credentialId, session, key, profileId } = await boot();
      const commands: readonly (readonly [string, unknown])[] = [
        ['auth.credential.revoke', { id: credentialId }],
        ['auth.session.revoke', { id: session.sessionId }],
        ['auth.logout', {}],
        ['auth.reauthenticate', { password: ownerPerson.password }],
        ['auth.extendSession', { sessionId: session.sessionId }],
        [
          'accounts.profile.changePassword',
          { id: profileId, currentPassword: ownerPerson.password, newPassword: fresh },
        ],
      ];
      for (const [action, input] of commands) {
        const outcome = await app.request(action, input, key);
        expect(outcome.ok, action).toBe(false);
        expect(outcome.ok ? undefined : outcome.error.kind, action).toBe('forbidden');
        expect(outcome.ok ? '' : outcome.error.message, action).toContain(sessionOnlyReason);
      }
    });

    test('a write key can neither revoke the credential of its owner nor a session, so it cannot lock the owner out', {
      timeout,
    }, async () => {
      const { app, credentialId, session, spare, key, login } = await boot();
      const revoked = await app.request('auth.credential.revoke', { id: credentialId }, key);
      const dropped = await app.request('auth.session.revoke', { id: spare.sessionId }, key);
      expect(revoked.ok || dropped.ok).toBe(false);
      // Both sessions and the password still stand, and the owner signs in again.
      expect((await app.request('auth.whoami', {}, session.sessionToken)).ok).toBe(true);
      expect((await app.request('auth.whoami', {}, spare.sessionToken)).ok).toBe(true);
      expect((await login()).sessionToken).toEqual(expect.any(String));
    });

    test('the owner session still passes, and the key still reads auth.credential.query, auth.session.query and auth.whoami', {
      timeout,
    }, async () => {
      const { app, credentialId, session, spare, key, profileId } = await boot();
      const asSession = (action: string, input: unknown) =>
        app.request(action, input, session.sessionToken);
      expect((await asSession('auth.reauthenticate', { password: ownerPerson.password })).ok).toBe(
        true,
      );
      expect((await asSession('auth.session.revoke', { id: spare.sessionId })).ok).toBe(true);
      const credentials = await app.request('auth.credential.query', {}, key);
      expect(
        credentials.ok
          ? (credentials.value as { items: { id: string }[] }).items.map((i) => i.id)
          : [],
      ).toEqual([credentialId]);
      const sessions = await app.request('auth.session.query', {}, key);
      expect(sessions.ok).toBe(true);
      const whoami = await app.request('auth.whoami', {}, key);
      expect(whoami.ok).toBe(true);
      const changed = await asSession('accounts.profile.changePassword', {
        id: profileId,
        currentPassword: ownerPerson.password,
        newPassword: fresh,
      });
      if (!changed.ok) throw changed.error;
      const rotated = (changed.value as { sessionToken: string }).sessionToken;
      expect((await app.request('auth.logout', {}, rotated)).ok).toBe(true);
    });
  },
);
