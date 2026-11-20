import { testOperator } from '@keelwerk/testing';
import { describe, expect, test } from 'vitest';
import { ada, codeOf } from './support/auth-calls.ts';
import { bootBoth } from './support/boot-both.ts';
import { delivered } from './support/mailbox/delivered.ts';

const refused = 'core.idempotency_mismatch';

describe('a finished auth command repeated under its command id on memory', () => {
  test('a login that succeeded is refused, and no second session is opened', async () => {
    delivered.length = 0;
    const both = await bootBoth('memory');
    try {
      const signUp = await both.request('auth.signUp', ada);
      if (!signUp.ok) throw signUp.error;
      const commandId = crypto.randomUUID();
      const first = await both.request('auth.login', ada, { commandId });
      expect(first.ok).toBe(true);
      const sessions = (await both.rows('auth.session')).length;
      expect(codeOf(await both.request('auth.login', ada, { commandId }))).toBe(refused);
      expect(await both.rows('auth.session')).toHaveLength(sessions);
      const again = await both.request('auth.login', ada, { commandId: crypto.randomUUID() });
      expect(again.ok).toBe(true);
      expect(await both.rows('auth.session')).toHaveLength(sessions + 1);
    } finally {
      await both.runtime.stop();
    }
  });

  test('a sign-up that succeeded is refused, with the same or another password', async () => {
    delivered.length = 0;
    const both = await bootBoth('memory');
    try {
      const commandId = crypto.randomUUID();
      expect((await both.request('auth.signUp', ada, { commandId })).ok).toBe(true);
      const credentials = (await both.rows('auth.credential')).length;
      expect(codeOf(await both.request('auth.signUp', ada, { commandId }))).toBe(refused);
      expect(
        codeOf(
          await both.request(
            'auth.signUp',
            { ...ada, password: 'another password 42' },
            { commandId },
          ),
        ),
      ).toBe(refused);
      expect(await both.rows('auth.credential')).toHaveLength(credentials);
    } finally {
      await both.runtime.stop();
    }
  });

  test('a password reset that succeeded is refused, with the same or another new password', async () => {
    delivered.length = 0;
    const both = await bootBoth('memory');
    try {
      const signUp = await both.request('auth.signUp', ada);
      if (!signUp.ok) throw signUp.error;
      const { token } = await both
        .client(testOperator())
        .invoke('auth.issueResetLink', { identifier: ada.identifier });
      const commandId = crypto.randomUUID();
      const reset = { token, newPassword: 'a brand new password 42' };
      expect((await both.request('auth.resetPassword', reset, { commandId })).ok).toBe(true);
      const receipt = await both.inUnit((unit) => unit.receipts.get(commandId));
      expect(codeOf(await both.request('auth.resetPassword', reset, { commandId }))).toBe(refused);
      expect(
        codeOf(
          await both.request(
            'auth.resetPassword',
            { ...reset, newPassword: 'yet another password 42' },
            { commandId },
          ),
        ),
      ).toBe(refused);
      expect(await both.inUnit((unit) => unit.receipts.get(commandId))).toEqual(receipt);
    } finally {
      await both.runtime.stop();
    }
  });
});
