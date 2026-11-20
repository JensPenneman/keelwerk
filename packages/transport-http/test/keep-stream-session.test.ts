import type { Clock, InvocationSession, KeelwerkError, Outcome } from '@keelwerk/core';
import { pinnedLiveTimers } from '@keelwerk/testing';
import { describe, expect, test, vi } from 'vitest';
import { keepStreamSession } from '../src/keep-stream-session.ts';
import { fakeSession } from './support/fake-session.ts';
import { userSession } from './support/user-session.ts';

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

describe('a renewal that holds other credentials than the checked session ends the stream', () => {
  const principalOf = (overrides: Record<string, unknown>): InvocationSession['principal'] =>
    ({ ...userSession('ada').principal, ...overrides }) as never;
  const heldSession = userSession('ada');
  const rows: [string, InvocationSession][] = [
    ['another subject', userSession('ada', { principal: principalOf({ subject: 'bob' }) })],
    [
      'another resolver of the stored reference',
      userSession('ada', {
        principal: principalOf({ ref: { resolver: 'other', principalId: 'ada' } }),
      }),
    ],
    [
      'another principal id of the stored reference',
      userSession('ada', {
        principal: principalOf({ ref: { resolver: 'test', principalId: 's2' } }),
      }),
    ],
    ['no stored reference', userSession('ada', { principal: principalOf({ ref: null }) })],
    [
      'another tenant of the principal',
      userSession('ada', { principal: principalOf({ scope: { backend: 'b1', tenant: 't2' } }) }),
    ],
    [
      'another backend of the principal',
      userSession('ada', { principal: principalOf({ scope: { backend: 'b2', tenant: 't1' } }) }),
    ],
    [
      'another level of the session scope',
      userSession('ada', { scope: { level: 'backend', backendId: 'b1' } }),
    ],
    [
      'another tenant of the session scope',
      userSession('ada', { scope: { level: 'tenant', backendId: 'b1', tenantId: 't2' } }),
    ],
    [
      'another backend of the session scope',
      userSession('ada', { scope: { level: 'tenant', backendId: 'b2', tenantId: 't1' } }),
    ],
  ];

  test.each(rows)('%s', async (_name, renewed) => {
    let now = start;
    const clock: Clock = { now: () => now };
    const timers = pinnedLiveTimers(clock);
    const session = userSession('ada', {
      scope: heldSession.scope,
      revalidate: async () => ({ ok: true, value: renewed }),
    });
    const ended: KeelwerkError[] = [];
    keepStreamSession({
      session,
      revalidateMs: 5_000,
      clock,
      timers,
      signal: new AbortController().signal,
      end: (error) => ended.push(error),
    });
    now = start.add({ milliseconds: 5_000 });
    await timers.fire();
    await vi.waitFor(() => expect(ended).toHaveLength(1));
    expect(ended[0]).toMatchObject({
      code: 'core.unauthenticated',
      message: 'The session no longer holds the credentials the stream opened with.',
    });
    await timers.fire();
    expect(ended).toHaveLength(1);
  });

  test('a renewal that differs in nothing keeps the stream', async () => {
    let now = start;
    const clock: Clock = { now: () => now };
    const timers = pinnedLiveTimers(clock);
    let calls = 0;
    const session = userSession('ada', {
      revalidate: async () => {
        calls += 1;
        return { ok: true, value: userSession('ada') };
      },
    });
    const ended: KeelwerkError[] = [];
    keepStreamSession({
      session,
      revalidateMs: 5_000,
      clock,
      timers,
      signal: new AbortController().signal,
      end: (error) => ended.push(error),
    });
    now = start.add({ milliseconds: 5_000 });
    await timers.fire();
    await vi.waitFor(() => expect(calls).toBe(1));
    await timers.fire();
    expect(ended).toEqual([]);
  });
});
