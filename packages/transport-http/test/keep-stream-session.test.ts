import type { Clock, InvocationSession, KeelwerkError, Outcome } from '@keelwerk/core';
import { pinnedLiveTimers } from '@keelwerk/testing';
import { expect, test, vi } from 'vitest';
import { keepStreamSession } from '../src/keep-stream-session.ts';
import { fakeSession } from './support/fake-session.ts';

const start = Temporal.Instant.from('2026-11-19T10:00:00Z');

test('a renewal seen at or after the expiry ends the stream even before the timer fires', async () => {
  let now = start;
  const clock: Clock = { now: () => now };
  const timers = pinnedLiveTimers(clock);
  let answer: (outcome: Outcome<InvocationSession>) => void = () => undefined;
  let calls = 0;
  const renewed = fakeSession({ expiresAt: start.add({ milliseconds: 20_000 }) });
  const session = fakeSession({
    expiresAt: start.add({ milliseconds: 10_000 }),
    revalidate: () => {
      calls += 1;
      return new Promise<Outcome<InvocationSession>>((resolve) => {
        answer = resolve;
      });
    },
  });
  const ended: KeelwerkError[] = [];
  keepStreamSession({
    session,
    revalidateMs: 3_600_000,
    clock,
    timers,
    signal: new AbortController().signal,
    end: (error) => ended.push(error),
  });
  now = start.add({ milliseconds: 9_000 });
  await timers.fire();
  await vi.waitFor(() => expect(calls).toBe(1));
  // The clock reaches the expiry while the timer of the check has not fired.
  now = start.add({ milliseconds: 10_000 });
  answer({ ok: true, value: renewed });
  await vi.waitFor(() => expect(ended).toHaveLength(1));
  expect(ended[0]).toMatchObject({ code: 'core.unauthenticated', message: 'The session expired.' });
  await timers.fire();
  expect(ended).toHaveLength(1);
  expect(calls).toBe(1);
});
