import { describe, expect, onTestFinished, test } from 'vitest';
import { ada, asBearer, signIn } from './support/auth-calls.ts';
import type { StorageKind } from './support/boot-auth.ts';
import { type BootedBoth, bootBoth } from './support/boot-both.ts';
import { watchUnits } from './support/watch-units.ts';

// The workers poll the job store and the log all the time: their calls are no store work of a request.
const polling = /^unit\.(jobs\.(promote|take|heartbeat|stats)|events\.head)$/;
const written = /^unit\.(rows\.(insert|update|delete)|events\.append|jobs\.(enqueue|cancel))$/;
const touched = (calls: readonly string[]) =>
  calls.filter((call) => /^unit\.(rows|events|jobs|keys)\./.test(call) && !polling.test(call));

describe.each(['memory', 'pglite'] as const)(
  'the internal commands of auth, on %s',
  (kind: StorageKind) => {
    const timeout = kind === 'pglite' ? 90_000 : 15_000;

    async function boot(): Promise<BootedBoth> {
      const both = await bootBoth(kind);
      onTestFinished(() => both.runtime.stop());
      expect((await both.request('auth.signUp', ada)).ok).toBe(true);
      return both;
    }

    const answerOf = (outcome: Awaited<ReturnType<BootedBoth['request']>>) =>
      outcome.ok ? 'allowed' : `${outcome.error.code}: ${outcome.error.message}`;

    const internal = [
      ['auth.deliverPasswordReset', (id: string) => ({ credentialId: id })],
      ['auth.revokeSessions', (id: string) => ({ subject: id })],
      ['auth.revokeSubject', (id: string) => ({ subject: id, reason: 'test' })],
    ] as const;

    // The answer of an action that does not exist, with the reference this one is asked under.
    const asUnknown = async (both: BootedBoth, action: string, input: unknown, headers?: object) =>
      answerOf(
        await both.request('auth.noSuchAction', input, { headers: headers as never }),
      ).replace('auth.noSuchAction', action);

    test.each(internal)(
      '%s answers like an unknown action, anonymous or signed in, whatever the input, and writes nothing',
      { timeout },
      async (action, inputOf) => {
        const both = await boot();
        const session = await signIn(both);
        await both.settle();
        const [credential] = await both.rows('auth.credential');
        const real = String(
          action === 'auth.deliverPasswordReset' ? credential?.id : credential?.subject,
        );
        for (const headers of [undefined, asBearer(session.sessionToken)]) {
          for (const id of [real, crypto.randomUUID(), 'not-an-id']) {
            const watch = watchUnits(both);
            const answer = answerOf(
              await both.request(action, inputOf(id), headers === undefined ? {} : { headers }),
            );
            expect(answer).toBe(await asUnknown(both, action, inputOf(id), headers));
            expect(answer).toMatch(/^core\.not_implemented/);
            const calls = touched(watch.units.flat());
            expect(calls.filter((call) => written.test(call))).toEqual([]);
            if (headers === undefined) expect(calls).toEqual([]);
          }
        }
        expect(await both.rows('auth.resetToken')).toHaveLength(0);
        expect((await both.rows('auth.session')).every((row) => row.revokedAt === undefined)).toBe(
          true,
        );
      },
    );
  },
);
