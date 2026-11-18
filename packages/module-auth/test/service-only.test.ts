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
  'the actions that only the module itself runs, on %s',
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

    test.each([
      ['auth.deliverPasswordReset', (id: string) => ({ credentialId: id })],
      ['auth.revokeSessions', (id: string) => ({ subject: id })],
    ] as const)(
      '%s refuses an anonymous caller before any store work, whatever the input',
      {
        timeout,
      },
      async (action, inputOf) => {
        const both = await boot();
        const [credential] = await both.rows('auth.credential');
        const real = String(
          action === 'auth.revokeSessions' ? credential?.subject : credential?.id,
        );
        const answers = new Set<string>();
        for (const id of [real, crypto.randomUUID()]) {
          const watch = watchUnits(both);
          answers.add(answerOf(await both.request(action, inputOf(id))));
          expect(touched(watch.units.flat())).toEqual([]);
        }
        expect(answers.size).toBe(1);
        expect([...answers][0]).toMatch(/^core\.(forbidden|unauthenticated)/);
      },
    );

    test.each([
      ['auth.deliverPasswordReset', (id: string) => ({ credentialId: id })],
      ['auth.revokeSessions', (id: string) => ({ subject: id })],
    ] as const)(
      '%s refuses an ordinary signed-in principal with one answer, whatever the input, and writes nothing',
      {
        timeout,
      },
      async (action, inputOf) => {
        const both = await boot();
        const session = await signIn(both);
        await both.settle();
        const [credential] = await both.rows('auth.credential');
        const real = String(
          action === 'auth.revokeSessions' ? credential?.subject : credential?.id,
        );
        const answers = new Set<string>();
        const works: string[][] = [];
        for (const id of [real, crypto.randomUUID()]) {
          const watch = watchUnits(both);
          answers.add(
            answerOf(
              await both.request(action, inputOf(id), { headers: asBearer(session.sessionToken) }),
            ),
          );
          const calls = touched(watch.units.flat());
          expect(calls.filter((call) => written.test(call))).toEqual([]);
          works.push(calls);
        }
        expect(answers.size).toBe(1);
        expect([...answers][0]).toMatch(/^core\.forbidden/);
        // The refusal is input-independent: the same store work for every input.
        expect(works[1]).toEqual(works[0]);
        expect(await both.rows('auth.resetToken')).toHaveLength(0);
        expect((await both.rows('auth.session')).every((row) => row.revokedAt === undefined)).toBe(
          true,
        );
      },
    );
  },
);
