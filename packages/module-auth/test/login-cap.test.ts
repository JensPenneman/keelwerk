import { KeelwerkError, type Unit } from '@keelwerk/core';
import { testOperator } from '@keelwerk/testing';
import { describe, expect, onTestFinished, test } from 'vitest';
import { ada, asBearer, codeOf, signIn } from './support/auth-calls.ts';
import type { StorageKind } from './support/boot-auth.ts';
import { type BootedBoth, bootBoth } from './support/boot-both.ts';

const operator = testOperator();

describe.each(['memory', 'pglite'] as const)(
  'the cap of sessions per credential on %s',
  (kind: StorageKind) => {
    const timeout = kind === 'pglite' ? 90_000 : 15_000;

    async function boot(auth: Readonly<Record<string, unknown>> = {}): Promise<BootedBoth> {
      // The failure budget is out of the way: these cases are about the cap of successful logins.
      const both = await bootBoth(kind, { auth: { identifierFailedAttempts: 1000, ...auth } });
      onTestFinished(() => both.runtime.stop());
      expect((await both.request('auth.signUp', ada)).ok).toBe(true);
      return both;
    }

    const credentialEvents = async (both: BootedBoth): Promise<readonly string[]> => {
      const [row] = await both.rows('auth.credential', { sealed: true });
      const id = String(row?.id);
      const events = await both.inUnit((unit) =>
        unit.events.readStream({ type: 'auth.credential', id }),
      );
      return events.map((event) => event.type);
    };
    const sessionCount = async (both: BootedBoth): Promise<number> =>
      (await both.rows('auth.session')).length;
    const login = (both: BootedBoth, password = ada.password) =>
      both.request('auth.login', { identifier: ada.identifier, password });

    test('a login after the cap within the minute is refused and appends nothing', {
      timeout,
    }, async () => {
      const both = await boot();
      for (let index = 0; index < 6; index += 1) expect((await login(both)).ok).toBe(true);
      const events = await credentialEvents(both);
      expect(await sessionCount(both)).toBe(6);
      both.clock.advance({ seconds: 20 });
      const refused = await login(both);
      expect(codeOf(refused)).toBe('core.rate_limited');
      // The oldest session leaves the minute after 40 more seconds.
      expect(refused.ok ? undefined : refused.error.retryAfter).toBe(40);
      expect(await credentialEvents(both)).toEqual(events);
      expect(await sessionCount(both)).toBe(6);
      both.clock.advance({ seconds: 41 });
      expect((await login(both)).ok).toBe(true);
    });

    test('a wrong password never charges the cap, and is answered as a wrong password beyond it', {
      timeout,
    }, async () => {
      const both = await boot();
      for (let index = 0; index < 12; index += 1) {
        expect(codeOf(await login(both, 'not the right password'))).toBe(
          'auth.invalid_credentials',
        );
      }
      for (let index = 0; index < 6; index += 1) expect((await login(both)).ok).toBe(true);
      expect(codeOf(await login(both))).toBe('core.rate_limited');
      // Nobody without the password learns that the cap is used up.
      expect(codeOf(await login(both, 'not the right password'))).toBe('auth.invalid_credentials');
    });

    test('the cap is configuration', { timeout }, async () => {
      const both = await boot({ successfulLoginsPerMinute: 2 });
      expect((await login(both)).ok).toBe(true);
      expect((await login(both)).ok).toBe(true);
      expect(codeOf(await login(both))).toBe('core.rate_limited');
    });

    test('logins that arrive together pass the cap no further than it allows', {
      timeout,
    }, async () => {
      const both = await boot();
      const answers = await Promise.all(Array.from({ length: 10 }, () => login(both)));
      expect(answers.filter((answer) => answer.ok)).toHaveLength(6);
      expect(answers.filter((answer) => codeOf(answer) === 'core.rate_limited')).toHaveLength(4);
      expect(await sessionCount(both)).toBe(6);
    });

    test('a change of password after the cap is refused, appends nothing and leaves the old password', {
      timeout,
    }, async () => {
      const both = await boot();
      const first = await signIn(both);
      for (let index = 0; index < 5; index += 1) await signIn(both);
      const events = await credentialEvents(both);
      const id = String((await both.rows('accounts.profile'))[0]?.id);
      const changed = await both.request(
        'accounts.profile.changePassword',
        { id, currentPassword: ada.password, newPassword: 'another long enough password' },
        { headers: asBearer(first.sessionToken) },
      );
      expect(codeOf(changed)).toBe('core.rate_limited');
      expect(await credentialEvents(both)).toEqual(events);
      both.clock.advance({ minutes: 2 });
      expect((await login(both)).ok).toBe(true);
    });

    test('a deactivation succeeds when a login commits between the unit that deactivates reads and commits', {
      timeout,
    }, async () => {
      const both = await boot();
      await signIn(both);
      const profileId = String((await both.rows('accounts.profile'))[0]?.id);
      const target = both.runtime.adapter as { unit: typeof both.runtime.adapter.unit };
      const inner = target.unit.bind(both.runtime.adapter);
      let conflicts = 0;
      // The first unit that revokes the credential finds the stream moved: a login committed after
      // its read. The login is committed here, once that unit has rolled back, and the kernel
      // repeats the deactivation, which reads the credential again.
      const doomed = { yes: false };
      const guarded = (unit: Unit): Unit => ({
        ...unit,
        events: {
          ...unit.events,
          append: async (batch) => {
            const revokes = batch.some(
              (one) =>
                one.stream.type === 'auth.credential' &&
                one.events.some((event) => event.name === 'revoked'),
            );
            if (revokes && conflicts === 0) {
              conflicts += 1;
              doomed.yes = true;
              throw new KeelwerkError({
                kind: 'conflict',
                code: 'core.version_mismatch',
                message: 'The stream moved.',
              });
            }
            return await unit.events.append(batch);
          },
        },
        nested: (run, nestedOptions) => unit.nested((one) => run(guarded(one)), nestedOptions),
      });
      target.unit = async (namespace, scope, fn, options) => {
        try {
          return await inner(namespace, scope, (unit) => fn(guarded(unit)), options);
        } catch (error) {
          if (doomed.yes) {
            doomed.yes = false;
            expect((await login(both)).ok).toBe(true);
          }
          throw error;
        }
      };
      const done = await both
        .client(operator)
        .attempt('accounts.profile.deactivate', { id: profileId as never, reason: 'left' });
      expect(done.ok ? undefined : done.error).toBeUndefined();
      expect(conflicts).toBe(1);
      const rows = await both.rows('auth.credential');
      expect(rows.every((row) => row.revokedAt !== undefined)).toBe(true);
      expect(
        (await credentialEvents(both)).filter((name) => name.endsWith('loggedIn')),
      ).toHaveLength(2);
      await both.settle();
      expect((await both.rows('auth.session')).every((row) => row.revokedAt !== undefined)).toBe(
        true,
      );
    });
  },
);
