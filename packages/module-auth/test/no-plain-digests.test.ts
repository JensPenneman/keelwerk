import { canonicalizeJson, type Id } from '@keelwerk/core';
import { findPlaintext } from '@keelwerk/testing';
import { describe, expect, onTestFinished, test } from 'vitest';
import { ada, asBearer, signIn } from './support/auth-calls.ts';
import type { StorageKind } from './support/boot-auth.ts';
import { type BootedBoth, bootBoth } from './support/boot-both.ts';
import { delivered } from './support/mailbox/delivered.ts';
import { plainFingerprint, sha256Hex } from './support/plain-fingerprint.ts';
import { walkStore } from './support/store-walk.ts';

const receiptForm = /^kwf1\.[0-9a-f]{64}$/;
const decisionForm = /^kw[bdr]1\.[0-9a-f]{64}$/;

describe.each(['memory', 'pglite'] as const)(
  'what the store holds after the password commands, on %s',
  (kind: StorageKind) => {
    const timeout = kind === 'pglite' ? 120_000 : 30_000;

    test('no record holds a password, a reset token or the plain SHA-256 of an input, and every digest is keyed', {
      timeout,
    }, async () => {
      delivered.length = 0;
      const both: BootedBoth = await bootBoth(kind);
      onTestFinished(() => both.runtime.stop());
      const walk = walkStore(both, kind);
      const passwords = {
        wrongLogin: 'wrong login password 1111',
        wrongReauth: 'wrong reauth password 2222',
        wrongCurrent: 'wrong current password 3333',
        taken: 'taken sign up password 4444',
        changed: 'changed password 5555',
        reset: 'reset password 6666',
      };
      const bogusToken = 'kwt_bogus_0123456789abcdefghijklmnopqrstuvwxyz0123456789';
      const calls: { readonly action: string; readonly input: unknown }[] = [];
      const signUpId = crypto.randomUUID();
      const request = (
        action: string,
        input: unknown,
        carrier: { readonly headers?: Record<string, string>; readonly commandId?: string } = {},
      ) => {
        calls.push({ action, input });
        return both.request(action, input, carrier);
      };

      // Each command, once refused and once successful.
      expect((await request('auth.signUp', ada, { commandId: signUpId })).ok).toBe(true);
      expect((await request('auth.signUp', { ...ada, password: passwords.taken })).ok).toBe(false);
      expect((await request('auth.login', { ...ada, password: passwords.wrongLogin })).ok).toBe(
        false,
      );
      const session = await signIn(both);
      calls.push({ action: 'auth.login', input: ada });
      const headers = asBearer(session.sessionToken);
      expect(
        (await request('auth.reauthenticate', { password: passwords.wrongReauth }, { headers })).ok,
      ).toBe(false);
      expect(
        (await request('auth.reauthenticate', { password: ada.password }, { headers })).ok,
      ).toBe(true);
      const id = String((await both.rows('accounts.profile'))[0]?.id) as Id<'accounts.profile'>;
      expect(
        (
          await request(
            'accounts.profile.changePassword',
            { id, currentPassword: passwords.wrongCurrent, newPassword: passwords.changed },
            { headers },
          )
        ).ok,
      ).toBe(false);
      const changed = await request(
        'accounts.profile.changePassword',
        { id, currentPassword: ada.password, newPassword: passwords.changed },
        { headers },
      );
      expect(changed.ok).toBe(true);
      // A request for a known identifier and one for an unknown one both set a delivery timer job.
      expect((await request('auth.requestPasswordReset', { identifier: ada.identifier })).ok).toBe(
        true,
      );
      expect(
        (await request('auth.requestPasswordReset', { identifier: 'nobody@example.org' })).ok,
      ).toBe(true);
      await both.settle();
      const token = delivered.at(-1)?.token ?? '';
      expect(token).not.toBe('');
      expect(
        (await request('auth.resetPassword', { token: bogusToken, newPassword: passwords.reset }))
          .ok,
      ).toBe(false);
      expect(
        (await request('auth.resetPassword', { token, newPassword: passwords.reset })).ok,
      ).toBe(true);
      expect(
        (await request('auth.resetPassword', { token, newPassword: passwords.reset })).ok,
      ).toBe(false);
      await both.settle();

      const { text, fingerprints, digests } = await walk.contents();
      const version = (await both.inUnit((unit) => unit.receipts.get(signUpId)))?.apiVersion ?? '';
      expect(version).not.toBe('');
      // The walk saw the store: the actions of the commands are in it.
      for (const action of new Set(calls.map((call) => call.action)))
        expect(text).toContain(action);
      const secrets = [
        ada.password,
        ...Object.values(passwords),
        token,
        bogusToken,
        ...delivered.map((message) => message.token),
      ];
      const plain = [
        ...secrets.map(sha256Hex),
        ...calls.flatMap(({ action, input }) => [
          plainFingerprint(action, version, input),
          sha256Hex(canonicalizeJson(input)),
        ]),
      ];
      expect(findPlaintext(text, secrets)).toEqual([]);
      expect(findPlaintext(text, plain)).toEqual([]);
      // Every receipt is the keyed form, every decision digest of an event is one of the three
      // forms.
      expect(fingerprints.length).toBeGreaterThanOrEqual(calls.length);
      for (const fingerprint of fingerprints) expect(fingerprint).toMatch(receiptForm);
      expect(digests.length).toBeGreaterThan(0);
      for (const digest of digests) expect(digest).toMatch(decisionForm);
    });
  },
);
