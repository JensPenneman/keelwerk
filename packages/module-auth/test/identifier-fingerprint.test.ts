import { testOperator } from '@keelwerk/testing';
import { describe, expect, onTestFinished, test } from 'vitest';
import { ada } from './support/auth-calls.ts';
import type { StorageKind } from './support/boot-auth.ts';
import { type BootedBoth, bootBoth } from './support/boot-both.ts';
import { plainFingerprint } from './support/plain-fingerprint.ts';

describe.each(['memory', 'pglite'] as const)(
  'the receipt of a command that takes an identifier on %s',
  (kind: StorageKind) => {
    const timeout = kind === 'pglite' ? 60_000 : 10_000;

    async function boot(): Promise<BootedBoth> {
      const both = await bootBoth(kind);
      onTestFinished(() => both.runtime.stop());
      return both;
    }

    /** The receipt of a command id, as the store holds it. */
    const receiptOf = (both: BootedBoth, commandId: string) =>
      both.inUnit((unit) => unit.receipts.get(commandId));

    test('holds no plain SHA-256 of an input with the identifier: it could be checked against a guessed address', {
      timeout,
    }, async () => {
      const both = await boot();
      const ids = {
        signUp: crypto.randomUUID(),
        login: crypto.randomUUID(),
        request: crypto.randomUUID(),
        link: crypto.randomUUID(),
      };
      const inputs = {
        signUp: ada,
        login: { identifier: ada.identifier, password: ada.password },
        request: { identifier: ada.identifier },
        link: { identifier: ada.identifier },
      };
      expect((await both.request('auth.signUp', inputs.signUp, { commandId: ids.signUp })).ok).toBe(
        true,
      );
      expect((await both.request('auth.login', inputs.login, { commandId: ids.login })).ok).toBe(
        true,
      );
      expect(
        (
          await both.request('auth.requestPasswordReset', inputs.request, {
            commandId: ids.request,
          })
        ).ok,
      ).toBe(true);
      await both
        .client(testOperator())
        .invoke('auth.issueResetLink', inputs.link, { commandId: ids.link });
      const actions = {
        signUp: 'auth.signUp',
        login: 'auth.login',
        request: 'auth.requestPasswordReset',
        link: 'auth.issueResetLink',
      } as const;
      for (const name of ['signUp', 'login', 'request', 'link'] as const) {
        const receipt = await receiptOf(both, ids[name]);
        expect(receipt?.fingerprint, name).toMatch(/^kwf1\.[0-9a-f]{64}$/);
        const plain = plainFingerprint(actions[name], receipt?.apiVersion ?? '', inputs[name]);
        expect(receipt?.fingerprint, name).not.toBe(plain);
        expect(receipt?.fingerprint, name).not.toContain(plain);
      }
    });
  },
);
