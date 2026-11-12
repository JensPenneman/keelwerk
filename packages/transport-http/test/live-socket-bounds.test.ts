import type { LiveServerMessage } from '@keelwerk/core';
import { type LoggedLine, recordingLogger } from '@keelwerk/testing';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { libraryActions } from './support/library-actions.ts';
import type { LiveSocketClient } from './support/live-socket-client.ts';
import { quietHub } from './support/quiet-hub.ts';
import { type SocketHost, type SocketHostOptions, socketHost } from './support/socket-host.ts';
import { userSession } from './support/user-session.ts';

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const hosts: SocketHost[] = [];
const clients: LiveSocketClient[] = [];
afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
  await Promise.all(hosts.splice(0).map((made) => made.host.stop(100)));
});

type Subscribe = Parameters<typeof socketHost>[0];

async function started(subscribe: Subscribe, options: SocketHostOptions = {}) {
  const made = await socketHost(subscribe, { session: userSession('ada'), ...options });
  hosts.push(made);
  return made;
}

async function opened(
  made: SocketHost,
  headers: Record<string, string> = {},
  options: { readonly autoPong?: boolean } = {},
): Promise<LiveSocketClient> {
  const client = await made.connect(headers, options);
  if (!('socket' in client)) throw new Error(`refused with ${client.status}`);
  clients.push(client);
  return client;
}

/** True when the client has not seen the socket close; the answer to a ping proves the server is alive. */
async function stillOpen(client: LiveSocketClient): Promise<boolean> {
  client.send({ type: 'ping' });
  const outcome = await Promise.race([
    client.until((message) => message.type === 'pong').then(() => 'open' as const),
    client.closed.then(() => 'closed' as const),
  ]);
  return outcome === 'open';
}

async function helloed(made: SocketHost, options: { readonly autoPong?: boolean } = {}) {
  const client = await opened(made, {}, options);
  client.send({ type: 'hello' });
  expect(await client.next()).toMatchObject({ type: 'welcome' });
  return client;
}

describe('the bounds of a socket', () => {
  test('no hello within 10 s closes 4000', async () => {
    const made = await started(quietHub({ open: 0 }));
    const client = await opened(made);
    await made.at(9_999);
    // A ping before the hello would itself be a protocol error: the state of the client is the proof.
    expect(client.socket.readyState).toBe(client.socket.OPEN);
    await made.at(10_000);
    expect(await client.closed).toMatchObject({ code: 4000 });
    expect(made.timers.pending()).toBe(0);
  });

  test('a second hello, a binary frame, invalid JSON or an unknown type closes 4000; neither reason nor log holds the text sent', async () => {
    const lines: LoggedLine[] = [];
    const secret = 'TOPSECRET-TEXT';
    const bad: readonly ((client: LiveSocketClient) => void)[] = [
      (client) => client.send({ type: 'hello', token: secret }),
      (client) => client.socket.send(Buffer.from(secret), { binary: true }),
      (client) => client.send(`{"type": ${secret}`),
      (client) => client.send({ type: secret }),
      (client) => client.send({ type: 'subscribe', id: `${secret} with a space`, action: 'x' }),
    ];
    for (const send of bad) {
      const made = await started(quietHub({ open: 0 }), {
        deps: { log: recordingLogger(lines) },
      });
      const client = await helloed(made);
      send(client);
      const closed = await client.closed;
      expect(closed.code).toBe(4000);
      expect(closed.reason).not.toContain(secret);
    }
    expect(JSON.stringify(lines)).not.toContain(secret);
  });

  test('a message above maxMessageBytes closes 1009', async () => {
    const made = await started(quietHub({ open: 0 }), {
      host: { liveSocket: { maxMessageBytes: 1000 } },
    });
    const client = await helloed(made);
    client.send({
      type: 'subscribe',
      id: 'x',
      action: 'loans.loanEvents',
      input: 'x'.repeat(5000),
    });
    expect(await client.closed).toMatchObject({ code: 1009 });
  });

  test('more messages than the window allows close 4429', async () => {
    const made = await started(quietHub({ open: 0 }));
    const client = await helloed(made);
    for (let index = 0; index < 250; index += 1) client.send({ type: 'ping' });
    expect(await client.closed).toMatchObject({ code: 4429 });
  });

  test('the 101st subscription is refused with core.quota_exceeded under its id', async () => {
    const state = { open: 0 };
    const made = await started(quietHub(state), {
      host: { liveSocket: { maxMessagesPerWindow: 1000 } },
    });
    const client = await helloed(made);
    for (let index = 0; index <= 100; index += 1) {
      client.send({ type: 'subscribe', id: `s${index}`, action: 'loans.loanEvents', input: {} });
    }
    const refused = await client.until((message) => message.type === 'error');
    expect(refused.at(-1)).toMatchObject({
      type: 'error',
      id: 's100',
      error: { code: 'core.quota_exceeded' },
    });
    await vi.waitFor(() => expect(state.open).toBe(100));
  });

  test('the 21st socket of a principal is 429 before accept, and a closed socket gives its slot back', async () => {
    const made = await started(quietHub({ open: 0 }));
    const sockets: LiveSocketClient[] = [];
    for (let index = 0; index < 20; index += 1) {
      const client = await opened(made);
      client.send({ type: 'hello', apiVersion: '2026-11-04' });
      expect(await client.next()).toMatchObject({ type: 'welcome' });
      sockets.push(client);
    }
    const refused = await made.connect();
    expect(refused).toMatchObject({
      status: 429,
      body: { error: { code: 'core.quota_exceeded' } },
    });
    await sockets[0]?.close();
    await vi.waitFor(async () => {
      const again = await made.connect();
      if (!('socket' in again)) throw new Error('still refused');
      clients.push(again);
    });
  });

  test('a missing pong terminates after 30 s and 10 s and every subscription ends with its slot back', async () => {
    const state = { open: 0 };
    const made = await started(quietHub(state));
    const client = await helloed(made, { autoPong: false });
    client.send({ type: 'subscribe', id: 'q', action: 'loans.loanEvents', input: {} });
    await vi.waitFor(() => expect(state.open).toBe(1));
    await made.at(30_000);
    // The ping is out and unanswered: the pong wait is armed.
    await vi.waitFor(() => expect(made.timers.pending()).toBeGreaterThan(0));
    await made.at(39_999);
    expect(client.socket.readyState).toBe(client.socket.OPEN);
    await made.at(40_000);
    await client.closed;
    await vi.waitFor(() => expect(state.open).toBe(0));
    await vi.waitFor(() => expect(made.timers.pending()).toBe(0));
  });

  test('a ping is answered and keeps the socket open', async () => {
    const made = await started(quietHub({ open: 0 }));
    const client = await helloed(made);
    const pings: number[] = [];
    client.socket.on('ping', () => pings.push(1));
    await made.at(30_000);
    // The client's reply to the ping is real traffic: wait for the ping to arrive, then for its pong to be taken.
    await vi.waitFor(() => expect(pings).toHaveLength(1));
    // Frames of one socket are read in order: the pong of the client is taken before this ping is answered.
    expect(await stillOpen(client)).toBe(true);
    await made.at(40_000);
    client.send({ type: 'ping' });
    expect(await client.next()).toEqual({ type: 'pong' });
  });

  test('a client that does not read is cut off after stallMs and its subscriptions end, with the byte bound set out of reach', async () => {
    const state = { open: 0 };
    const big = 'x'.repeat(900_000);
    const made = await started(
      (invocation) =>
        (async function* () {
          state.open += 1;
          try {
            while (!invocation.signal.aborted) {
              yield { event: big };
              await new Promise((resolve) => setImmediate(resolve));
            }
          } finally {
            state.open -= 1;
          }
        })(),
      {
        host: {
          liveSocket: { heartbeatMs: 1_000_000_000 },
          // Far above anything the test queues: only the stall timer can end this socket.
          live: { maxBufferedBytes: 256 * 1_048_576 },
        },
      },
    );
    const client = await helloed(made);
    client.socket.pause();
    const baseline = made.timers.pending();
    client.send({ type: 'subscribe', id: 'flood', action: 'loans.loanEvents', input: {} });
    await vi.waitFor(() => expect(state.open).toBe(1));
    // The stall bound starts when the send stops draining: each round moves the clock past one more bound.
    for (let round = 0; round < 400 && state.open > 0; round += 1) {
      await made.at(30_000 * (round + 1));
      await vi.waitFor(() =>
        expect(state.open === 0 || made.timers.pending() > baseline).toBe(true),
      );
    }
    expect(state.open).toBe(0);
    // The paused client only learns of the cut once it reads again.
    client.socket.resume();
    await client.closed;
    await vi.waitFor(() => expect(made.timers.pending()).toBe(0));
  });

  test('several subscriptions of a client that does not read pass the write bound and end on a clock that never moves', async () => {
    const state = { open: 0 };
    const chunk = 'x'.repeat(300_000);
    const made = await started(
      (invocation) =>
        (async function* () {
          state.open += 1;
          try {
            while (!invocation.signal.aborted) {
              yield { event: chunk };
              await new Promise((resolve) => setImmediate(resolve));
            }
          } finally {
            state.open -= 1;
          }
        })(),
      {
        host: { liveSocket: { heartbeatMs: 1_000_000_000 }, live: { maxBufferedBytes: 1_048_576 } },
      },
    );
    const client = await helloed(made);
    client.socket.pause();
    for (const id of ['a', 'b', 'c', 'd']) {
      client.send({ type: 'subscribe', id, action: 'loans.loanEvents', input: {} });
    }
    // The clock never moves: only the write bound can end them.
    await vi.waitFor(() => expect(state.open).toBe(0), { timeout: 20_000 });
    client.socket.resume();
    await client.closed;
  });

  test('invokes above maxPendingInvokes answer core.quota_exceeded unrun', async () => {
    const made = await started(quietHub({ open: 0 }), {
      host: { liveSocket: { maxPendingInvokes: 2 } },
      actions: libraryActions,
    });
    const client = await helloed(made);
    for (let index = 0; index < 10; index += 1) {
      client.send({
        type: 'invoke',
        id: `i${index}`,
        request: { action: 'library.echo', input: index },
      });
    }
    const results: LiveServerMessage[] = [];
    await client.until((message) => {
      if (message.type === 'result') results.push(message);
      return results.length === 10;
    });
    const refused = results.filter(
      (message) =>
        message.type === 'result' &&
        !message.response.ok &&
        message.response.error.code === 'core.quota_exceeded',
    );
    expect(refused.length).toBeGreaterThanOrEqual(1);
    expect(made.invoker.invoked.length + refused.length).toBe(10);
  });
});
