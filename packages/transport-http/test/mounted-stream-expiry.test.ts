import type { InvocationSession, Outcome, Principal } from '@keelwerk/core';
import { describe, expect, test, vi } from 'vitest';
import { drained } from './support/drained.ts';
import { fakeSession } from './support/fake-session.ts';
import { mounted } from './support/mounted-stream.ts';
import { pinnedTime } from './support/pinned-time.ts';
import { useHosts } from './support/use-hosts.ts';
import { userSession } from './support/user-session.ts';

const { setup } = useHosts();
const waitMs = 30_000;
const { start } = pinnedTime();
const at = (ms: number): Temporal.Instant => start.add({ milliseconds: ms });

const userOf = (principalId: string): Principal => ({
  ...userSession('ada').principal,
  ref: { resolver: 'test', principalId },
});

const anonymous: Principal = {
  kind: 'anonymous',
  scope: { backend: 'b1', tenant: 't1' },
  claims: {},
  roles: [],
  memberships: [],
  via: 'none',
  ref: null,
};

describe('the host ends a mounted stream at its expiry', () => {
  test('a renewal that answers only after the expiry ends the stream at the expiry', async () => {
    let calls = 0;
    let answer: (outcome: Outcome<InvocationSession>) => void = () => undefined;
    const late: InvocationSession = fakeSession({ expiresAt: at(20_000) });
    const session: InvocationSession = fakeSession({
      expiresAt: at(10_000),
      revalidate: () => {
        calls += 1;
        return new Promise<Outcome<InvocationSession>>((resolve) => {
          answer = resolve;
        });
      },
    });
    // The next open (of the one slot) is of a session without an expiry: the first slot is free again.
    const { open, move, ended, record, timers } = mounted(
      setup,
      (opened) => (opened === 0 ? session : fakeSession()),
      { maxDurationMs: 86_400_000, revalidateMs: 3_600_000 },
    );
    const body = drained(await open());
    await move(9_000);
    expect(calls).toBe(1);
    await move(999);
    expect(ended()).toHaveLength(0);
    await move(1);
    await body;
    expect(ended()).toHaveLength(1);
    expect(ended()[0]).toMatchObject({ fields: { reason: 'core.unauthenticated' } });
    answer({ ok: true, value: late });
    await move(10_000);
    expect(ended()).toHaveLength(1);
    expect(calls).toBe(1);
    await vi.waitFor(() => expect(record.cancelled).toBe(1), { timeout: waitMs });
    expect(timers.pending()).toBe(0);
    const next = await open();
    expect(next.status).toBe(200);
    await next.body?.cancel();
  }, 120_000);

  test('a periodic check just before the window is followed by the check at the expiry one second after it', async () => {
    const calledAt: number[] = [];
    const session: InvocationSession = fakeSession({
      expiresAt: at(10_000),
      revalidate: async () => {
        calledAt.push(made.clock.now().epochMilliseconds - start.epochMilliseconds);
        return { ok: true, value: session };
      },
    });
    const made = mounted(setup, session, { maxDurationMs: 86_400_000, revalidateMs: 8_500 });
    const body = drained(await made.open());
    await made.move(8_499);
    expect(calledAt).toEqual([]);
    await made.move(1);
    expect(calledAt).toEqual([8_500]);
    await made.move(998);
    await made.move(1);
    expect(calledAt).toEqual([8_500]);
    await made.move(1);
    expect(calledAt).toEqual([8_500, 9_500]);
    await made.move(499);
    expect(made.ended()).toHaveLength(0);
    await made.move(1);
    await body;
    expect(calledAt).toEqual([8_500, 9_500]);
    expect(made.ended()[0]).toMatchObject({ fields: { reason: 'core.unauthenticated' } });
  }, 120_000);

  test('a renewal without an expiry keeps the stream under the periodic check', async () => {
    let calls = 0;
    const open: InvocationSession = fakeSession({
      revalidate: async () => {
        calls += 1;
        return { ok: true, value: open };
      },
    });
    const session: InvocationSession = fakeSession({
      expiresAt: at(10_000),
      revalidate: async () => {
        calls += 1;
        return { ok: true, value: open };
      },
    });
    const {
      move,
      ended,
      open: connect,
    } = mounted(setup, session, {
      maxDurationMs: 86_400_000,
      revalidateMs: 30_000,
    });
    const body = drained(await connect());
    await move(9_000);
    expect(calls).toBe(1);
    await move(1_000);
    expect(ended()).toHaveLength(0);
    await move(28_999);
    expect(calls).toBe(1);
    expect(ended()).toHaveLength(0);
    await move(1);
    expect(calls).toBe(2);
    await move(30_000);
    expect(calls).toBe(3);
    expect(ended()).toHaveLength(0);
    await move(86_400_000);
    await body;
    expect(ended()[0]).toMatchObject({ fields: { reason: 'max_duration' } });
  }, 120_000);

  test('a renewal that moves the expiry by a millisecond each time is asked once per second at most', async () => {
    const calledAt: number[] = [];
    const sessionAt = (ms: number): InvocationSession =>
      fakeSession({
        expiresAt: at(ms),
        revalidate: async () => {
          calledAt.push(made.clock.now().epochMilliseconds - start.epochMilliseconds);
          return { ok: true, value: sessionAt(ms + 1) };
        },
      });
    const made = mounted(setup, sessionAt(10_000), {
      maxDurationMs: 86_400_000,
      revalidateMs: 3_600_000,
    });
    const body = drained(await made.open());
    for (let elapsed = 0; elapsed < 12_000; elapsed += 500) await made.move(500);
    await body;
    expect(calledAt.length).toBeGreaterThan(0);
    for (const [index, called] of calledAt.entries()) {
      expect(called - (calledAt[index - 1] ?? Number.NEGATIVE_INFINITY)).toBeGreaterThanOrEqual(
        1_000,
      );
    }
    expect(made.ended()[0]).toMatchObject({ fields: { reason: 'core.unauthenticated' } });
  }, 120_000);

  test.each<[string, Partial<InvocationSession>]>([
    ['a logout answers an anonymous principal with no expiry', { principal: anonymous }],
    ['a renewal under another stored reference', { principal: userOf('s2') }],
    [
      'a renewal of another subject under the same stored reference',
      { principal: { ...userOf('s1'), subject: 'bob' } as never },
    ],
    [
      'a renewal whose principal is in another tenant',
      { principal: { ...userOf('s1'), scope: { backend: 'b1', tenant: 't2' } } },
    ],
    [
      'a renewal whose principal is in another backend',
      { principal: { ...userOf('s1'), scope: { backend: 'b2', tenant: 't1' } } },
    ],
    [
      'a renewal whose session scope is another tenant',
      { principal: userOf('s1'), scope: { level: 'tenant', backendId: 'b1', tenantId: 't2' } },
    ],
    [
      'a renewal whose session scope is another backend',
      { principal: userOf('s1'), scope: { level: 'tenant', backendId: 'b2', tenantId: 't1' } },
    ],
  ])(
    '%s: the stream ends at the check',
    async (_name, replaced) => {
      const renewed: InvocationSession = fakeSession(replaced);
      const session: InvocationSession = fakeSession({
        principal: userOf('s1'),
        expiresAt: at(3_600_000),
        revalidate: async () => ({ ok: true, value: renewed }),
      });
      const { open, move, ended, record } = mounted(setup, session, {
        maxDurationMs: 86_400_000,
        revalidateMs: 5_000,
      });
      const body = drained(await open());
      await move(4_999);
      expect(ended()).toHaveLength(0);
      await move(1);
      await vi.waitFor(() => expect(ended()).toHaveLength(1), { timeout: 2_000 });
      await body;
      expect(ended()[0]).toMatchObject({ fields: { reason: 'core.unauthenticated' } });
      expect(record.contextSignals[0]?.aborted).toBe(true);
    },
    120_000,
  );

  test('a renewal for the same principal keeps the stream open', async () => {
    const renewed: InvocationSession = fakeSession({ principal: userOf('s1') });
    const session: InvocationSession = fakeSession({
      principal: userOf('s1'),
      revalidate: async () => ({ ok: true, value: renewed }),
    });
    const { open, move, ended } = mounted(setup, session, {
      maxDurationMs: 86_400_000,
      revalidateMs: 5_000,
    });
    await open();
    await move(5_000);
    await move(5_000);
    expect(ended()).toHaveLength(0);
  }, 120_000);

  test('a check that does not answer within one interval ends the stream unavailable', async () => {
    let calls = 0;
    const session: InvocationSession = fakeSession({
      revalidate: () => {
        calls += 1;
        return new Promise<Outcome<InvocationSession>>(() => undefined);
      },
    });
    const { open, move, ended } = mounted(setup, session, {
      maxDurationMs: 86_400_000,
      revalidateMs: 5_000,
    });
    const body = drained(await open());
    await move(5_000);
    expect(calls).toBe(1);
    await move(4_999);
    expect(ended()).toHaveLength(0);
    await move(1);
    await body;
    expect(calls).toBe(1);
    expect(ended()[0]).toMatchObject({ fields: { reason: 'core.unavailable' } });
  }, 120_000);

  test('a chunk that reaches the host after the expiry is dropped before the timer of the expiry has run', async () => {
    let route: ReadableStreamDefaultController<Uint8Array> | undefined;
    const session: InvocationSession = fakeSession({
      expiresAt: at(10_000),
      revalidate: () => new Promise<Outcome<InvocationSession>>(() => undefined),
    });
    const { open, move, jump, ended, record } = mounted(setup, session, {
      maxDurationMs: 86_400_000,
      revalidateMs: 3_600_000,
      keep: (controller) => {
        route = controller;
      },
    });
    const body = drained(await open());
    // The clock passes the expiry; no timer has fired yet, as when the event loop is busy.
    jump(10_002);
    route?.enqueue(new TextEncoder().encode('data: late\n\n'));
    await vi.waitFor(() => expect(ended()).toHaveLength(1), { timeout: 2_000 });
    expect(await body).toBe('data: first\n\n');
    expect(ended()[0]).toMatchObject({ fields: { reason: 'core.unauthenticated' } });
    expect(record.contextSignals[0]?.aborted).toBe(true);
    await move(1_000);
    expect(ended()).toHaveLength(1);
  }, 120_000);

  test('a session that has expired at the open is answered 401: the route is not called, no slot is taken, nothing is logged as a failure', async () => {
    const expired: InvocationSession = fakeSession({ expiresAt: at(0) });
    const { open, record, ended, lines, timers } = mounted(
      setup,
      (opened) => (opened === 0 ? expired : fakeSession()),
      { maxDurationMs: 86_400_000, revalidateMs: 3_600_000 },
    );
    const refused = await open();
    expect(refused.status).toBe(401);
    expect(await refused.text()).toContain('core.unauthenticated');
    expect(record.contextSignals).toEqual([]);
    expect(timers.pending()).toBe(0);
    // The one slot of the principal was never taken: the next stream is admitted.
    const next = await open();
    expect(next.status).toBe(200);
    expect(record.contextSignals).toHaveLength(1);
    await next.body?.cancel();
    expect(ended()).toEqual([]);
    expect(lines.filter((line) => line.level === 'error')).toEqual([]);
  }, 120_000);
});
