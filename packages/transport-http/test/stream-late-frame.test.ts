import type { InvocationSession, LiveFrame, Outcome, StateToken } from '@keelwerk/core';
import { pinnedLiveTimers } from '@keelwerk/testing';
import { describe, expect, test } from 'vitest';
import { createFakeHost, type FakeHost } from './support/create-fake-host.ts';
import { createFakeInvoker } from './support/fake-invoker.ts';
import { fakeAction, fakeSurface, stringNode } from './support/fake-surface.ts';
import { realSseCarrier } from './support/real-sse-carrier.ts';
import { userSession } from './support/user-session.ts';

const start = Temporal.Instant.from('2026-11-11T12:00:00Z');
const token = (n: number): StateToken =>
  `v2.0.${n}.00000000.00000000000000000000000000000000` as StateToken;
const action = fakeAction('loans.loanEvents', { kind: 'subscription', output: stringNode });

/** The host's own subscribe endpoint and a route that serves its stream through `serveStream`. */
const paths = ['the host’s own subscribe stream', 'a stream a mounted route serves'] as const;

describe.each(paths)('an item written after the expiry, before its timer ran, on %s', (path) => {
  test('never reaches the client: the stream ends with the expiry', async () => {
    let now = start;
    const clock = { now: () => now };
    const timers = pinnedLiveTimers(clock);
    const late = Promise.withResolvers<void>();
    const session: InvocationSession = userSession('ada', {
      expiresAt: start.add({ milliseconds: 10_000 }),
      revalidate: () => new Promise<Outcome<InvocationSession>>(() => undefined),
    });
    const frames = (): AsyncIterable<LiveFrame<unknown>> =>
      (async function* () {
        yield { control: 'head', state: token(1) } as const;
        await late.promise;
        yield { event: 'late', state: token(2) };
        await new Promise(() => undefined);
      })();
    const base = createFakeInvoker({ open: () => ({ ok: true as const, value: session }) });
    const made: FakeHost = createFakeHost(
      { liveSocket: { revalidateMs: 3_600_000 } },
      {
        invoker: { ...base, subscribe: frames } as unknown as typeof base,
        surface: fakeSurface([action]),
        deps: { liveCarrier: () => realSseCarrier(), clock, timers },
      },
    );
    made.host.route({ app: 'library', transport: 'rest', prefix: '/api' }, async (_request, ctx) =>
      ctx.serveStream === undefined
        ? new Response('no stream', { status: 400 })
        : ctx.serveStream(frames(), { action, surfaceHash: 'hash-1' }),
    );
    const response = await made.host.fetch(
      path === paths[0]
        ? new Request('https://x.example/_keelwerk/v1/subscribe?action=loans.loanEvents')
        : new Request('https://x.example/api/events', { headers: { accept: 'text/event-stream' } }),
      { remoteAddress: '198.18.0.5' },
    );
    expect(response.status).toBe(200);
    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    let text = '';
    while (!text.includes('event: head')) {
      const chunk = await reader?.read();
      if (chunk === undefined || chunk.done) break;
      text += decoder.decode(chunk.value);
    }
    // The clock passes the expiry and no timer has fired, as when the event loop is busy.
    now = start.add({ milliseconds: 10_000 });
    late.resolve();
    // The item is written (or dropped) now; the timers fire after it, as a late timer does.
    await new Promise((resolve) => setImmediate(resolve));
    await timers.fire();
    for (;;) {
      const chunk = await reader?.read();
      if (chunk === undefined || chunk.done) break;
      text += decoder.decode(chunk.value);
    }
    expect(text).not.toContain('late');
    expect(text).toContain('event: error');
    expect(text).toContain('core.unauthenticated');
    await made.host.stop(100);
  });
});
