import type { InvocationSession, Outcome } from '@keelwerk/core';
import { type LoggedLine, recordingLogger } from '@keelwerk/testing';
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

describe('the host ends a mounted stream at the edges', () => {
  test('a renewal that never answers ends the stream at its expiry', async () => {
    let calls = 0;
    const session: InvocationSession = fakeSession({
      expiresAt: start.add({ milliseconds: 10_000 }),
      revalidate: () => {
        calls += 1;
        return new Promise<Outcome<InvocationSession>>(() => undefined);
      },
    });
    const { open, move, ended } = mounted(setup, session, {
      maxDurationMs: 86_400_000,
      revalidateMs: 3_600_000,
    });
    const body = drained(await open());
    await move(8_999);
    expect(calls).toBe(0);
    expect(ended()).toHaveLength(0);
    await move(1);
    expect(calls).toBe(1);
    await move(999);
    expect(ended()).toHaveLength(0);
    await move(1);
    await body;
    expect(calls).toBe(1);
    expect(ended()[0]).toMatchObject({ fields: { reason: 'core.unauthenticated' } });
  }, 120_000);

  test('a route frame enqueued after the expiry never reaches the client', async () => {
    let route: ReadableStreamDefaultController<Uint8Array> | undefined;
    const session: InvocationSession = fakeSession({
      expiresAt: start.add({ milliseconds: 10_000 }),
      revalidate: () => new Promise<Outcome<InvocationSession>>(() => undefined),
    });
    const { open, move, ended } = mounted(setup, session, {
      maxDurationMs: 86_400_000,
      revalidateMs: 3_600_000,
      keep: (controller) => {
        route = controller;
      },
    });
    const body = drained(await open());
    await move(10_000);
    try {
      route?.enqueue(new TextEncoder().encode('data: late\n\n'));
    } catch {
      // The host already cancelled the route's body.
    }
    await move(1_000);
    expect(await body).toBe('data: first\n\n');
    expect(ended()).toHaveLength(1);
  }, 120_000);

  test('when the floor falls at or after the expiry the stream ends at the expiry without a check', async () => {
    let calls = 0;
    const session: InvocationSession = fakeSession({
      expiresAt: start.add({ milliseconds: 500 }),
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
    await move(499);
    expect(ended()).toHaveLength(0);
    await move(1);
    await body;
    expect(calls).toBe(0);
    expect(ended()[0]).toMatchObject({ fields: { reason: 'core.unauthenticated' } });
  }, 120_000);

  test('a stream that opens while the host stops is told to go away', async () => {
    const lines: LoggedLine[] = [];
    const time = pinnedTime();
    const made = setup(
      { live: { maxDurationMs: 86_400_000 } },
      createFakeInvoker({ actions: libraryActions }),
      { clock: time.clock, timers: time.timers, log: recordingLogger(lines) },
    );
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered = false;
    made.host.route({ app: 'library', transport: 'sse-test', prefix: '/events' }, async () => {
      entered = true;
      await gate;
      return new Response(
        new ReadableStream<Uint8Array>({
          start: (controller) => controller.enqueue(new TextEncoder().encode('data: first\n\n')),
        }),
        { headers: { 'content-type': 'text/event-stream' } },
      );
    });
    const asked = made.host.fetch(
      new Request('https://library.example/events/x', { headers: { accept: 'text/event-stream' } }),
      { remoteAddress: '198.18.0.5' },
    );
    await vi.waitFor(() => expect(entered).toBe(true), { timeout: waitMs });
    const stopping = made.host.stop(100);
    release();
    const response = await asked;
    await drained(response);
    await stopping;
    const goodbyes = lines.filter((line) => line.message === 'stream ended by the host');
    expect(goodbyes).toHaveLength(1);
    expect(goodbyes[0]).toMatchObject({ fields: { reason: 'going_away' } });
  }, 120_000);

  test('a stream whose body closes by itself leaves no wait, no goodbye at stop and a free slot', async () => {
    const lines: LoggedLine[] = [];
    const time = pinnedTime();
    const made = setup(
      { live: { maxDurationMs: 86_400_000, maxStreamsPerPrincipal: 1 } },
      createFakeInvoker({ actions: libraryActions }),
      { clock: time.clock, timers: time.timers, log: recordingLogger(lines) },
    );
    made.host.route({ app: 'library', transport: 'sse-test', prefix: '/events' }, async () => {
      return new Response(
        new ReadableStream<Uint8Array>({
          start: (controller) => {
            controller.enqueue(new TextEncoder().encode('data: only\n\n'));
            controller.close();
          },
        }),
        { headers: { 'content-type': 'text/event-stream' } },
      );
    });
    const ask = () =>
      made.host.fetch(
        new Request('https://library.example/events/x', {
          headers: { accept: 'text/event-stream' },
        }),
        { remoteAddress: '198.18.0.5' },
      );
    const before = time.timers.pending();
    const first = await ask();
    expect(await drained(first)).toBe('data: only\n\n');
    await vi.waitFor(() => expect(time.timers.pending()).toBe(before), { timeout: waitMs });
    const next = await ask();
    expect(next.status).toBe(200);
    await drained(next);
    await made.host.stop(100);
    expect(lines.filter((line) => line.message === 'stream ended by the host')).toHaveLength(0);
  }, 120_000);
});
