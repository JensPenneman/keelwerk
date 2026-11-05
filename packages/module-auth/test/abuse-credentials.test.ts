import type { Id } from '@keelwerk/core';
import { describe, expect, onTestFinished, test } from 'vitest';
import { ada, asBearer, codeOf, signIn } from './support/auth-calls.ts';
import type { StorageKind } from './support/boot-auth.ts';
import { type BootedBoth, bootBoth } from './support/boot-both.ts';

describe.each(['memory', 'pglite'] as const)(
  'credential change limits on %s',
  (kind: StorageKind) => {
    const timeout = kind === 'pglite' ? 60_000 : 10_000;

    async function boot(): Promise<BootedBoth> {
      const both = await bootBoth(kind);
      onTestFinished(() => both.runtime.stop());
      const done = await both.request('auth.signUp', ada);
      if (!done.ok) throw done.error;
      return both;
    }

    test('changePassword shares the per-subject failure bucket of reauthenticate', {
      timeout,
    }, async () => {
      const both = await boot();
      const headers = asBearer((await signIn(both)).sessionToken);
      const id = String((await both.rows('accounts.profile'))[0]?.id) as Id<'accounts.profile'>;
      const guess = (action: 'change' | 'reauthenticate') =>
        action === 'change'
          ? both.request(
              'accounts.profile.changePassword',
              { id, currentPassword: 'wrong guess', newPassword: 'another password 43' },
              { headers },
            )
          : both.request('auth.reauthenticate', { password: 'wrong guess' }, { headers });
      for (const action of [
        'change',
        'reauthenticate',
        'change',
        'reauthenticate',
        'change',
      ] as const) {
        expect(codeOf(await guess(action))).toBe('auth.invalid_credentials');
      }
      expect(codeOf(await guess('change'))).toBe('core.rate_limited');
      expect(codeOf(await guess('reauthenticate'))).toBe('core.rate_limited');
      expect(
        codeOf(
          await both.request(
            'accounts.profile.changePassword',
            { id, currentPassword: ada.password, newPassword: 'another password 43' },
            { headers },
          ),
        ),
      ).toBe('core.rate_limited');
    });

    test('answers of auth.reauthentication_required do not lock reauthenticate', {
      timeout,
    }, async () => {
      const both = await boot();
      const headers = asBearer((await signIn(both)).sessionToken);
      const id = String((await both.rows('accounts.profile'))[0]?.id) as Id<'accounts.profile'>;
      both.clock.advance({ minutes: 30 });
      for (let attempt = 0; attempt < 6; attempt += 1) {
        expect(
          codeOf(
            await both.request(
              'accounts.profile.changePassword',
              { id, newPassword: 'another password 43' },
              { headers },
            ),
          ),
        ).toBe('auth.reauthentication_required');
      }
      expect(
        (await both.request('auth.reauthenticate', { password: ada.password }, { headers })).ok,
      ).toBe(true);
    });

    test('reset requests are limited per identifier and answer the same for a known and an unknown one', {
      timeout,
    }, async () => {
      const both = await boot();
      const run = async (identifier: string) => {
        const answers: unknown[] = [];
        for (let index = 0; index < 7; index += 1) {
          const done = await both.request('auth.requestPasswordReset', { identifier });
          answers.push(done.ok ? done.value : codeOf(done));
        }
        return answers;
      };
      const known = await run(ada.identifier);
      const unknown = await run('nobody@example.org');
      expect(known).toEqual(unknown);
      expect(known.slice(0, 5)).toEqual(Array(5).fill({ accepted: true }));
      expect(known.slice(5)).toEqual(['core.rate_limited', 'core.rate_limited']);
    });
  },
);
