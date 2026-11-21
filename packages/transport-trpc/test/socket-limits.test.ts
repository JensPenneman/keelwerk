import { describe, expect, onTestFinished, test, vi } from 'vitest';
import { trpcWsBridgeOf } from '../src/socket/trpc-ws-bridge-of.ts';
import { FakeTrpcSocket } from './support/fake-trpc-socket.ts';
import { keelwerkOf, queryMessage, served, waitOptions } from './support/served-trpc-socket.ts';
import { envelope, mountedTrpc, sendTrpc, trpcConformanceSurface } from './support/trpc-kit.ts';

/** Turns of the event loop: an admission and a call that a wrongly handed message starts are asynchronous and need some. */
async function turns(count = 20): Promise<void> {
  for (let turn = 0; turn < count; turn += 1) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

describe('what one socket may carry and run at once', () => {
  test('a message longer than the body limit is dropped and closes the socket 4400 core.payload_too_large without running', async () => {
    const oversized = JSON.stringify({
      id: 1,
      method: 'query',
      params: { path: 'library.findByIsbn', input: envelope({ isbn: 'x'.repeat(2_000) }) },
    });
    // What tRPC's listeners are handed is what a call would start from: a message handed on although it
    // was refused shows in `heard` at once and again after the turns of the event loop that a call needs.
    const probe = new FakeTrpcSocket();
    const bridge = trpcWsBridgeOf(probe as unknown as WebSocket, () => 1024);
    const heard: string[] = [];
    bridge.client.on('message', (data) => heard.push(data.toString()));
    bridge.attach();
    probe.message(oversized);
    await turns();
    expect(heard).toEqual([]);
    expect(probe.closedWith).toEqual({ code: 4400, reason: 'core.payload_too_large' });
    // The same over the whole handler: the close, and no answer and no call after the turns.
    const { socket, mounted } = await served({ config: { maxBodyBytes: 1024 } });
    socket.message(oversized);
    await vi.waitFor(
      () => expect(socket.closedWith).toEqual({ code: 4400, reason: 'core.payload_too_large' }),
      waitOptions,
    );
    await turns();
    expect(socket.sent).toEqual([]);
    expect(mounted.calls).toEqual([]);
  });

  test("the calls of one socket hold at most the host's call slots: the third is refused core.quota_exceeded unrun, and every slot is given back", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    // A case that fails while calls wait on the gate must not leave them waiting.
    onTestFinished(() => release());
    const { socket, mounted, held } = await served({
      connection: { maxPendingInvokes: 2 },
      respond: async () => {
        await gate;
        return { ok: true as const, value: {} };
      },
    });
    // A refused command holds no slot once it is refused: its slot is taken before the refusal and given back.
    socket.message(
      JSON.stringify({
        id: 100,
        method: 'mutation',
        params: {
          path: 'loans.lend',
          input: envelope({
            bookTitle: 'Dune',
            dueAt: Temporal.Instant.from('2026-12-01T00:00:00Z'),
          }),
        },
      }),
    );
    expect(keelwerkOf(await socket.errorFor(100))).toMatchObject({ code: 'core.unsupported' });
    for (const id of [1, 2, 3]) socket.message(queryMessage(id));
    expect(keelwerkOf(await socket.errorFor(3))).toMatchObject({ code: 'core.quota_exceeded' });
    await vi.waitFor(() => expect(mounted.calls).toHaveLength(2), waitOptions);
    expect(held.invocations).toEqual({ taken: 3, released: 1 });
    release();
    await socket.sentFor(1);
    await socket.sentFor(2);
    socket.message(queryMessage(4));
    const [again] = await socket.sentFor(4);
    expect(again).toMatchObject({ id: 4, result: { type: 'data' } });
    expect(mounted.calls).toHaveLength(3);
    expect(held.invocations).toEqual({ taken: 4, released: 4 });
  });

  test('three queries in one frame on a socket of two call slots: two run, the third is refused core.quota_exceeded on its own id unrun, and every slot is given back', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { socket, mounted, held } = await served({
      connection: { maxPendingInvokes: 2 },
      respond: async () => {
        await gate;
        return { ok: true as const, value: {} };
      },
    });
    try {
      socket.message(JSON.stringify([1, 2, 3].map((id) => JSON.parse(queryMessage(id)))));
      expect(keelwerkOf(await socket.errorFor(3))).toMatchObject({ code: 'core.quota_exceeded' });
      // The two that hold a slot are at the invoker and wait on the gate: the refusal of the third came while they ran.
      await vi.waitFor(() => expect(mounted.calls).toHaveLength(2), waitOptions);
      expect(socket.sent).toHaveLength(1);
      expect(held.invocations).toEqual({ taken: 2, released: 0 });
    } finally {
      release();
    }
    await socket.sentFor(1);
    await socket.sentFor(2);
    expect(mounted.calls).toHaveLength(2);
    expect(held.invocations).toEqual({ taken: 2, released: 2 });
  });

  test('a message is measured when it is handed over, against the limit of the session that was opened', () => {
    const socket = new FakeTrpcSocket();
    let limit = 1_000;
    const bridge = trpcWsBridgeOf(socket as unknown as WebSocket, () => limit);
    const heard: string[] = [];
    bridge.client.on('message', (data) => heard.push(data.toString()));
    socket.message('a'.repeat(900));
    limit = 500;
    bridge.attach();
    expect(heard).toEqual([]);
    expect(socket.closedWith).toEqual({ code: 4400, reason: 'core.payload_too_large' });
  });

  test('the first message is measured when it is taken, and one within the limit is handed over', async () => {
    const socket = new FakeTrpcSocket();
    let limit = 1_000;
    const bridge = trpcWsBridgeOf(socket as unknown as WebSocket, () => limit);
    socket.message('b'.repeat(100));
    socket.message('c'.repeat(900));
    expect(await bridge.first()).toBe('b'.repeat(100));
    limit = 500;
    expect(await bridge.first()).toBeUndefined();
    expect(socket.closedWith).toEqual({ code: 4400, reason: 'core.payload_too_large' });
  });

  test('the body bound means the same over HTTP and over the socket: strictly more than maxBodyBytes bytes, bytes and not characters', async () => {
    const limit = 1_000;
    // 'é' is two bytes: 499 of them and 'ab' are 1,000 bytes in 501 characters, one more byte is over.
    const within = `${'é'.repeat(499)}ab`;
    const over = `${within}c`;
    expect([Buffer.byteLength(within), Buffer.byteLength(over)]).toEqual([limit, limit + 1]);
    const mounted = await mountedTrpc(trpcConformanceSurface(), () => ({ ok: true, value: {} }), {
      config: { maxBodyBytes: limit },
    });
    const post = (rawBody: string) =>
      sendTrpc(mounted.handler, 'loans.lend', { method: 'POST', rawBody });
    // A body within the bound reaches tRPC, which refuses it as no JSON (400); one more byte is refused as too large.
    expect((await post(within)).status).toBe(400);
    expect((await post(over)).status).toBe(413);
    const socket = new FakeTrpcSocket();
    const bridge = trpcWsBridgeOf(socket as unknown as WebSocket, () => limit);
    const heard: string[] = [];
    bridge.client.on('message', (data) => heard.push(data.toString()));
    bridge.attach();
    socket.message(within);
    expect(heard).toEqual([within]);
    expect(socket.closedWith).toBeUndefined();
    socket.message(over);
    expect(heard).toEqual([within]);
    expect(socket.closedWith).toEqual({ code: 4400, reason: 'core.payload_too_large' });
  });

  test("what waits for the host to open is bounded by the smaller of the body limit and the host's message bound: with the body limit far above it, past four host bounds the socket closes 4429", async () => {
    const opening = Promise.withResolvers<void>();
    onTestFinished(() => opening.resolve());
    const { socket, held } = await served({
      url: 'wss://portal.example/trpc?connectionParams=1',
      config: { maxBodyBytes: 100_000 },
      connection: { maxMessageBytes: 100, openGate: opening.promise },
    });
    socket.message(JSON.stringify({ method: 'connectionParams', data: {} }));
    // The handler waits on the host's open: what the client sends now is held.
    await vi.waitFor(() => expect(held.opened).toEqual([{}]), waitOptions);
    for (let index = 0; index < 4; index += 1) socket.message('f'.repeat(90));
    expect(socket.closedWith).toBeUndefined();
    socket.message('f'.repeat(90));
    expect(socket.closedWith).toEqual({ code: 4429, reason: 'core.quota_exceeded' });
  });

  test('what waits for the host to open is bounded in bytes: past four limits the socket closes 4429 core.quota_exceeded', () => {
    const socket = new FakeTrpcSocket();
    const bridge = trpcWsBridgeOf(socket as unknown as WebSocket, () => 100);
    const heard: string[] = [];
    bridge.client.on('message', (data) => heard.push(data.toString()));
    for (let index = 0; index < 4; index += 1) socket.message('d'.repeat(90));
    expect(socket.closedWith).toBeUndefined();
    socket.message('d'.repeat(90));
    expect(socket.closedWith).toEqual({ code: 4429, reason: 'core.quota_exceeded' });
    bridge.attach();
    expect(heard).toEqual([]);
  });
});
