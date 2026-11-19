import type { InvocationSession, Outcome } from '@keelwerk/core';
import { coreError } from '@keelwerk/core/http';
import { describe, expect, test, vi } from 'vitest';
import { drained } from './support/drained.ts';
import { createFakeInvoker } from './support/fake-invoker.ts';
import { fakeSession } from './support/fake-session.ts';
import { libraryActions } from './support/library-actions.ts';
import { mounted } from './support/mounted-stream.ts';
import { pinnedTime } from './support/pinned-time.ts';
import { useHosts } from './support/use-hosts.ts';

const { setup } = useHosts();
const waitMs = 30_000;
const { start } = pinnedTime();

const freeAgain = async (open: () => Promise<Response>): Promise<void> => {
  const next = await open();
  expect(next.status).toBe(200);
  await next.body?.cancel();
};

describe('the host ends a mounted stream', () => {
  test("at the maximum duration the body ends cleanly, the route's signal aborts, its body is cancelled and the slot is free", async () => {
    const { open, move, record, ended } = mounted(setup, fakeSession());
    const response = await open();
    const body = drained(response);
    await move(29_999);
    expect(record.contextSignals[0]?.aborted).toBe(false);
    expect(ended()).toHaveLength(0);
    await move(1);
    expect(await body).toBe('data: first\n\n');
    expect(record.contextSignals[0]?.aborted).toBe(true);
    expect(record.requestSignals[0]?.aborted).toBe(true);
    await vi.waitFor(() => expect(record.cancelled).toBe(1), { timeout: waitMs });
    expect(ended()).toHaveLength(1);
    expect(ended()[0]).toMatchObject({ level: 'info', fields: { reason: 'max_duration' } });
    await freeAgain(open);
  }, 120_000);

  test("at the host's stop every counted stream ends cleanly", async () => {
    const { open, host, record, ended } = mounted(setup, fakeSession(), {
      maxDurationMs: 86_400_000,
    });
    const first = await open('198.18.0.5');
    const second = await open('198.18.0.6');
    const bodies = [drained(first), drained(second)];
    await host.stop(100);
    await Promise.all(bodies);
    expect(record.contextSignals.map((signal) => signal.aborted)).toEqual([true, true]);
    await vi.waitFor(() => expect(record.cancelled).toBe(2), { timeout: waitMs });
    expect(ended().map((line) => line.fields?.reason)).toEqual(['going_away', 'going_away']);
  }, 120_000);

  test('a session that no longer resolves at the re-check ends the stream within one revalidation interval', async () => {
    let answers = 0;
    const session: InvocationSession = fakeSession({
      revalidate: async (): Promise<Outcome<InvocationSession>> => {
        answers += 1;
        return answers === 1
          ? { ok: true, value: session }
          : {
              ok: false,
              error: coreError('core.unauthenticated', { message: 'The key is revoked.' }),
            };
      },
    });
    const { open, move, record, ended } = mounted(setup, session, { maxDurationMs: 86_400_000 });
    const body = drained(await open());
    await move(5_000);
    expect(answers).toBe(1);
    expect(record.contextSignals[0]?.aborted).toBe(false);
    expect(ended()).toHaveLength(0);
    await move(5_000);
    await body;
    expect(record.contextSignals[0]?.aborted).toBe(true);
    expect(ended()[0]).toMatchObject({ fields: { reason: 'core.unauthenticated' } });
    await freeAgain(open);
  }, 120_000);

  test('a renewal without a later expiry ends the stream at the expiry', async () => {
    let calls = 0;
    const session: InvocationSession = fakeSession({
      expiresAt: start.add({ milliseconds: 10_000 }),
      revalidate: async () => {
        calls += 1;
        return { ok: true, value: session };
      },
    });
    const { open, move, ended } = mounted(setup, session, {
      maxDurationMs: 86_400_000,
      revalidateMs: 3_600_000,
    });
    const body = drained(await open());
    await move(8_999);
    expect(calls).toBe(0);
    await move(1);
    expect(calls).toBe(1);
    await move(999);
    expect(ended()).toHaveLength(0);
    await move(1);
    await body;
    expect(calls).toBe(1);
    expect(ended()[0]).toMatchObject({ fields: { reason: 'core.unauthenticated' } });
    await freeAgain(open);
  }, 120_000);

  test('a renewal with a later expiry keeps the stream until that expiry', async () => {
    const renewed: InvocationSession = fakeSession({
      expiresAt: start.add({ milliseconds: 20_000 }),
      revalidate: async () => ({ ok: true, value: renewed }),
    });
    const session: InvocationSession = fakeSession({
      expiresAt: start.add({ milliseconds: 10_000 }),
      revalidate: async () => ({ ok: true, value: renewed }),
    });
    const { open, move, ended } = mounted(setup, session, {
      maxDurationMs: 86_400_000,
      revalidateMs: 3_600_000,
    });
    const body = drained(await open());
    await move(9_000);
    await move(1_000);
    expect(ended()).toHaveLength(0);
    await move(9_999);
    expect(ended()).toHaveLength(0);
    await move(1);
    await body;
    expect(ended()[0]).toMatchObject({ fields: { reason: 'core.unauthenticated' } });
  }, 120_000);

  test('a renewal that answers after a real macrotask, before the expiry, with a later expiry keeps the stream past the first expiry', async () => {
    let calls = 0;
    let answered = false;
    const renewed: InvocationSession = fakeSession({
      expiresAt: start.add({ milliseconds: 20_000 }),
      revalidate: async () => ({ ok: true, value: renewed }),
    });
    const session: InvocationSession = fakeSession({
      expiresAt: start.add({ milliseconds: 10_000 }),
      revalidate: async () => {
        calls += 1;
        await new Promise((resolve) => setTimeout(resolve, 20));
        answered = true;
        return { ok: true, value: renewed };
      },
    });
    const { open, move, ended, record } = mounted(setup, session, {
      maxDurationMs: 86_400_000,
      revalidateMs: 3_600_000,
    });
    const body = drained(await open());
    await move(9_000);
    expect(calls).toBe(1);
    await vi.waitFor(() => expect(answered).toBe(true), { timeout: waitMs });
    await move(1_000);
    expect(ended()).toHaveLength(0);
    expect(record.contextSignals[0]?.aborted).toBe(false);
    await move(9_999);
    expect(ended()).toHaveLength(0);
    await move(1);
    await body;
    expect(ended()[0]).toMatchObject({ fields: { reason: 'core.unauthenticated' } });
  }, 120_000);

  test('a check that throws ends the stream', async () => {
    const session: InvocationSession = fakeSession({
      revalidate: async () => {
        throw new Error('the resolver is down');
      },
    });
    const { open, move, ended } = mounted(setup, session, { maxDurationMs: 86_400_000 });
    const body = drained(await open());
    await move(5_000);
    await body;
    expect(ended()).toHaveLength(1);
    await freeAgain(open);
  }, 120_000);

  test('two endings due at once end the stream once', async () => {
    const session: InvocationSession = fakeSession({
      expiresAt: start.add({ milliseconds: 30_000 }),
      revalidate: async () => ({ ok: true, value: session }),
    });
    const { open, move, ended } = mounted(setup, session, { revalidateMs: 3_600_000 });
    const body = drained(await open());
    await move(30_000);
    await body;
    expect(ended()).toHaveLength(1);
  }, 120_000);

  test('a stream that ends on its own, or whose client leaves, leaves no wait behind', async () => {
    const { open, timers, host, record, ended } = mounted(setup, fakeSession(), {
      maxDurationMs: 86_400_000,
    });
    const before = timers.pending();
    const leaving = await open();
    expect(timers.pending()).toBeGreaterThan(before);
    await leaving.body?.cancel();
    await vi.waitFor(() => expect(timers.pending()).toBe(before), { timeout: waitMs });
    expect(record.cancelled).toBe(1);
    await host.stop(100);
    expect(ended()).toHaveLength(0);
  }, 120_000);

  test('a counted answer without a body takes no wait and frees the slot', async () => {
    const time = pinnedTime();
    const made = setup(
      { live: { maxStreamsPerPrincipal: 1 } },
      createFakeInvoker({ actions: libraryActions }),
      { clock: time.clock, timers: time.timers },
    );
    made.host.route(
      { app: 'library', transport: 'sse-test', prefix: '/events' },
      async () => new Response(null, { status: 204 }),
    );
    const before = time.timers.pending();
    const ask = () =>
      made.host.fetch(
        new Request('https://library.example/events/x', {
          headers: { accept: 'text/event-stream' },
        }),
        { remoteAddress: '198.18.0.5' },
      );
    expect((await ask()).status).toBe(204);
    expect(time.timers.pending()).toBe(before);
    expect((await ask()).status).toBe(204);
  }, 120_000);
});
