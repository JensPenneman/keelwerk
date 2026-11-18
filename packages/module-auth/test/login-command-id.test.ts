import { describe, expect, test } from 'vitest';
import { ada, codeOf } from './support/auth-calls.ts';
import { type BootedAuth, bootAuth, type StorageKind } from './support/boot-auth.ts';

describe.each(['memory', 'pglite'] as const)(
  'a login under a client command id on %s',
  (kind: StorageKind) => {
    const timeout = kind === 'pglite' ? 60_000 : 10_000;

    test('a refused password is pinned to the id: the right password with the same id answers the recorded refusal, a new id logs in', {
      timeout,
    }, async () => {
      const auth: BootedAuth = await bootAuth(kind);
      try {
        const signUp = await auth.request('auth.signUp', ada);
        if (!signUp.ok) throw signUp.error;
        const commandId = crypto.randomUUID();
        const wrong = { identifier: ada.identifier, password: 'a wrong password 42' };
        expect(codeOf(await auth.request('auth.login', wrong, { commandId }))).toBe(
          'auth.invalid_credentials',
        );
        // The receipt covers no password: the same id with the right one answers the recorded
        // refusal.
        expect(codeOf(await auth.request('auth.login', ada, { commandId }))).toBe(
          'auth.invalid_credentials',
        );
        // A new command id runs the login again.
        const again = await auth.request('auth.login', ada, { commandId: crypto.randomUUID() });
        expect(again.ok).toBe(true);
      } finally {
        await auth.runtime.stop();
      }
    });
  },
);
