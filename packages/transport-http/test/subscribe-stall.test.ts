import { afterEach, describe, expect, test } from 'vitest';
import { fakeSession } from './support/fake-session.ts';
import { type StreamHost, streamHost } from './support/stream-host.ts';

const hosts: StreamHost[] = [];
afterEach(async () => {
  await Promise.all(hosts.splice(0).map((made) => made.host.stop(100)));
});

const stallMs = 5_000;
const live = { maxBufferedBytes: 250, stallMs, heartbeatMs: 1_000_000, maxDurationMs: 100_000_000 };

/** A subscription that is quiet until its signal aborts, and that says whether it is still open. */
function quiet(state: { open: number; aborted: boolean }) {
  return (invocation: { readonly signal?: AbortSignal }) =>
    (async function* () {
      state.open += 1;
      try {
        await new Promise<void>((resolve) => {
          invocation.signal?.addEventListener(
            'abort',
            () => {
              state.aborted = true;
              resolve();
            },
            { once: true },
          );
        });
      } finally {
        state.open -= 1;
      }
    })();
}

function started(state = { open: 0, aborted: false }, session = fakeSession()): StreamHost {
  const made = streamHost(quiet(state), { host: { live }, session });
  hosts.push(made);
  return made;
}

describe('a client that does not read', () => {
  test('is closed at stallMs and not at stallMs - 1, and its subscription ends', async () => {
    const state = { open: 0, aborted: false };
    const made = streamHost(
      (invocation) =>
        (async function* () {
          state.open += 1;
          try {
            await new Promise<void>((resolve) =>
              invocation.signal?.addEventListener('abort', () => resolve(), { once: true }),
            );
          } finally {
            state.open -= 1;
          }
        })(),
      { host: { live: { ...live, maxBufferedBytes: 100 } } },
    );
    hosts.push(made);
    // The welcome alone passes the 100-byte bound: the carrier's first write waits for the client.
    const response = await made.open();
    await made.at(0);
    expect(made.timers.pending()).toBeGreaterThan(0);
    expect(await made.at(stallMs - 1)).toBe(0);
    expect(made.subscribed[0]?.signal?.aborted).toBe(false);
    expect(await made.at(stallMs)).toBeGreaterThan(0);
    expect(made.subscribed[0]?.signal?.aborted).toBe(true);
    await expect(response.text()).rejects.toBeDefined();
    expect(made.timers.pending()).toBe(0);
  });

  test('a write that drains before stallMs leaves no stall wait pending (the deadline and the heartbeat remain)', async () => {
    const made = started();
    const response = await made.open();
    await made.at(0);
    await made.at(stallMs - 1);
    // The client reads everything that is queued: the stalled write resolves and its wait is aborted.
    const reader = response.body?.getReader();
    const first = await reader?.read();
    expect(first?.done).toBe(false);
    await made.at(stallMs - 1);
    expect(made.timers.pending()).toBe(2);
    await reader?.cancel();
  });

  test('after the stream ended is closed at stallMs and not before, its queue dropped', async () => {
    const state = { open: 0, aborted: false };
    const made = started(state);
    const response = await made.open();
    await made.at(0);
    // The deadline ends the stream (an end frame joins the queue); the client has read nothing.
    await made.at(100_000_000);
    await made.at(100_000_000);
    expect(state.open).toBe(0);
    expect(made.timers.pending()).toBe(1);
    expect(await made.at(100_000_000 + stallMs - 1)).toBe(0);
    expect(await made.at(100_000_000 + stallMs)).toBe(1);
    await expect(response.text()).rejects.toBeDefined();
    expect(made.timers.pending()).toBe(0);
  });

  test('a client that reads an ended stream to its end leaves no wait pending', async () => {
    const made = started();
    const response = await made.open();
    await made.at(0);
    await made.at(100_000_000);
    const text = await response.text();
    expect(text).toContain('event: end');
    expect(made.timers.pending()).toBe(0);
  });
});
