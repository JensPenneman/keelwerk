import type { InvocationSession, LiveServerMessage } from '@keelwerk/core';
import { coreError } from '@keelwerk/core/http';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { WebSocket } from 'ws';
import { libraryActions } from './support/library-actions.ts';
import type { LiveSocketClient } from './support/live-socket-client.ts';
import { quietHub } from './support/quiet-hub.ts';
import { type SocketHost, type SocketHostOptions, socketHost } from './support/socket-host.ts';
import { userSession } from './support/user-session.ts';

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const hosts: SocketHost[] = [];
const clients: LiveSocketClient[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(clients.splice(0).map((client) => client.close()));
  await Promise.all(hosts.splice(0).map((made) => made.host.stop(100)));
});

async function started(options: SocketHostOptions = {}) {
  const made = await socketHost(quietHub({ open: 0 }), { session: userSession('ada'), ...options });
  hosts.push(made);
  return made;
}

async function opened(
  made: SocketHost,
  options: { readonly autoPong?: boolean } = {},
): Promise<LiveSocketClient> {
  const client = await made.connect({}, options);
  if (!('socket' in client)) throw new Error(`refused with ${client.status}`);
  clients.push(client);
  return client;
}

async function helloed(made: SocketHost, options: { readonly autoPong?: boolean } = {}) {
  const client = await opened(made, options);
  client.send({ type: 'hello' });
  expect(await client.next()).toMatchObject({ type: 'welcome' });
  return client;
}

const pause = () => new Promise<void>((resolve) => setImmediate(resolve));

/** A session whose checks answer from `state`. */
function revocable(state: { revoked: boolean }) {
  const session: InvocationSession = userSession('ada', {
    revalidate: async () =>
      state.revoked
        ? { ok: false, error: coreError('core.unauthenticated') }
        : { ok: true, value: session },
  });
  return session;
}

describe('what a socket that does not read can make the host hold', () => {
  test('a flood of ping frames from a client that never reads is cut off before the socket holds more than maxBufferedBytes', async () => {
    const written: number[] = [];
    const pong = WebSocket.prototype.pong;
    vi.spyOn(WebSocket.prototype, 'pong').mockImplementation(function (
      this: WebSocket,
      ...args: Parameters<WebSocket['pong']>
    ) {
      written.push(this.bufferedAmount);
      return pong.apply(this, args);
    });
    const made = await started({
      host: {
        liveSocket: { maxMessagesPerWindow: 1_000_000_000 },
        live: { maxBufferedBytes: 65_536 },
      },
    });
    const client = await helloed(made, { autoPong: false });
    client.socket.pause();
    const frame = Buffer.alloc(125);
    for (
      let sent = 0;
      sent < 400_000 && client.socket.readyState === client.socket.OPEN;
      sent += 1
    ) {
      client.socket.ping(frame);
      if (sent % 500 === 0) await pause();
    }
    client.socket.resume();
    const outcome = await Promise.race([
      client.closed.then(() => 'closed' as const),
      new Promise<'open'>((resolve) => setTimeout(() => resolve('open'), 5_000)),
    ]);
    expect(outcome).toBe('closed');
    expect(written.length).toBeGreaterThan(0);
    expect(Math.max(...written)).toBeLessThanOrEqual(65_536);
  });

  test('ping frames count against the message window: more than 200 in 10 s close 4429', async () => {
    const made = await started();
    const client = await helloed(made);
    for (let index = 0; index < 250; index += 1) client.socket.ping();
    expect(await client.closed).toMatchObject({ code: 4429 });
  });

  test('unsolicited pong frames count against the message window: more than 200 in 10 s close 4429', async () => {
    const made = await started();
    const client = await helloed(made);
    for (let index = 0; index < 250; index += 1) client.socket.pong();
    expect(await client.closed).toMatchObject({ code: 4429 });
  });

  test('a pong that does not echo the heartbeat ping keeps nothing alive', async () => {
    const made = await started();
    const client = await helloed(made, { autoPong: false });
    const unsolicited = async () => {
      client.socket.pong(Buffer.from('unsolicited'));
      client.socket.pong();
      // Frames are read in order: the answer to this message means both pongs were taken.
      client.send({ type: 'ping' });
      await client.until((message) => message.type === 'pong');
    };
    await unsolicited();
    await made.at(30_000);
    await vi.waitFor(() => expect(made.timers.pending()).toBeGreaterThan(0));
    await unsolicited();
    await made.at(39_999);
    expect(client.socket.readyState).toBe(client.socket.OPEN);
    await made.at(40_000);
    await client.closed;
  });

  test('a socket stops reading once the unread messages hold more than maxMessageBytes, and reads on when they are taken', async () => {
    const pauses = vi.spyOn(WebSocket.prototype, 'pause');
    let opens = 0;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const session = userSession('ada');
    const made = await started({
      open: async () => {
        opens += 1;
        // The upgrade's session opens at once; the hello's holds the receive loop.
        if (opens > 1) await gate;
        return { ok: true, value: session };
      },
    });
    const client = await opened(made);
    client.send({ type: 'hello', apiVersion: '2026-11-04' });
    await vi.waitFor(() => expect(opens).toBe(2));
    // Eight messages of 200 KB: fewer than the 16 the count allows, more than one MiB in bytes.
    const padding = 'x'.repeat(200_000);
    for (let index = 0; index < 8; index += 1) client.send({ type: 'ping', padding });
    await vi.waitFor(() => expect(pauses).toHaveBeenCalled(), { timeout: 5_000 });
    release();
    expect(await client.next()).toMatchObject({ type: 'welcome' });
    const answers: LiveServerMessage[] = [];
    await client.until((message) => {
      if (message.type === 'pong') answers.push(message);
      return answers.length === 8;
    });
  });

  test('invokes queued above four times maxMessageBytes of text answer core.quota_exceeded unrun, below the count bound', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const made = await started({
      host: { liveSocket: { maxMessageBytes: 2_000 } },
      actions: {
        ...libraryActions,
        'library.echo': () => gate.then(() => ({ ok: true, value: 'done' })) as never,
      },
    });
    const client = await helloed(made);
    const input = 'x'.repeat(1_400);
    for (let index = 0; index < 8; index += 1) {
      client.send({ type: 'invoke', id: `i${index}`, request: { action: 'library.echo', input } });
    }
    const refused: string[] = [];
    await client.until((message) => {
      if (message.type === 'result' && !message.response.ok) {
        expect(message.response.error.code).toBe('core.quota_exceeded');
        refused.push(message.id);
      }
      return refused.length === 3;
    });
    expect(refused).toEqual(['i5', 'i6', 'i7']);
    release();
    const done: string[] = [];
    await client.until((message) => {
      if (message.type === 'result' && message.response.ok) done.push(message.id);
      return done.length === 5;
    });
    expect(made.invoker.invoked).toHaveLength(5);
  });
});

describe('a socket and its session', () => {
  test('a command on a socket whose session was revoked runs nothing, as on POST /invoke', async () => {
    const state = { revoked: false };
    const made = await started({ session: revocable(state), actions: libraryActions });
    const client = await helloed(made);
    client.send({ type: 'invoke', id: 'a', request: { action: 'library.echo', input: 1 } });
    expect((await client.until((message) => message.type === 'result')).at(-1)).toMatchObject({
      response: { ok: true },
    });
    state.revoked = true;
    client.send({ type: 'invoke', id: 'b', request: { action: 'library.echo', input: 2 } });
    // The check says so as the socket's own error and closes it; the answer to the command has nowhere to go.
    const seen = await client.until((message) => message.type === 'error');
    expect(seen.at(-1)).toMatchObject({ error: { kind: 'unauthenticated' } });
    expect(made.invoker.invoked).toHaveLength(1);
    expect(await client.closed).toMatchObject({ code: 4401 });
  });

  test('a query on a socket whose session was revoked is refused as a command is, and runs nothing', async () => {
    const state = { revoked: false };
    const made = await started({ session: revocable(state), actions: libraryActions });
    const client = await helloed(made);
    client.send({ type: 'invoke', id: 'a', request: { action: 'library.lookup' } });
    expect((await client.until((message) => message.type === 'result')).at(-1)).toMatchObject({
      response: { ok: true },
    });
    state.revoked = true;
    client.send({ type: 'invoke', id: 'b', request: { action: 'library.lookup' } });
    const seen = await client.until((message) => message.type === 'error');
    expect(seen.at(-1)).toMatchObject({ error: { kind: 'unauthenticated' } });
    expect(made.invoker.invoked).toHaveLength(1);
    expect(await client.closed).toMatchObject({ code: 4401 });
  });

  test('a client that leaves while its hello opens a session aborts that open', async () => {
    let opens = 0;
    let seen: AbortSignal | undefined;
    const session = userSession('ada');
    const made = await started({
      open: (_carrier, options) => {
        opens += 1;
        if (opens === 1) return Promise.resolve({ ok: true as const, value: session });
        seen = options?.signal;
        return new Promise((resolve) => {
          options?.signal?.addEventListener(
            'abort',
            () => resolve({ ok: false as const, error: coreError('core.unavailable') }),
            { once: true },
          );
        });
      },
    });
    const client = await opened(made);
    client.send({ type: 'hello', apiVersion: '2026-11-04' });
    await vi.waitFor(() => expect(seen).toBeDefined());
    expect(seen?.aborted).toBe(false);
    client.socket.terminate();
    await vi.waitFor(() => expect(seen?.aborted).toBe(true), { timeout: 5_000 });
  });
});
