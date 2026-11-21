import { type LiveFrame, versionProjection } from '@keelwerk/core';
import { describe, expect, test, vi } from 'vitest';
import {
  headState,
  httpContext,
  keelwerkOf,
  queryMessage,
  respond,
  served,
  subscriptionMessage,
  waitOptions,
} from './support/served-trpc-socket.ts';
import {
  envelope,
  mountedTrpc,
  trpcConformanceSurface,
  trpcSession,
  trpcSurfaceWith,
} from './support/trpc-kit.ts';

describe('the keelwerk.trpc.v1 handler over the host session', () => {
  test('registers keelwerk.trpc.v1 on the route path and refuses a backend without websocket', async () => {
    const off = await mountedTrpc(trpcConformanceSurface(), respond);
    expect(off.upgraded).toMatchObject([{ path: '/trpc', protocols: ['keelwerk.trpc.v1'] }]);
    expect(off.upgraded[0]?.handler.refuse?.(httpContext)).toMatchObject({
      code: 'core.not_found',
      kind: 'not_found',
    });
    const on = await mountedTrpc(trpcConformanceSurface(), respond, {
      config: { websocket: true },
    });
    expect(on.upgraded[0]?.handler.refuse?.(httpContext)).toBeUndefined();
  });

  test('without connectionParams the upgrade session opens at once with no credentials', async () => {
    const { socket, held } = await served();
    await vi.waitFor(() => expect(held.opened).toEqual([{}]), waitOptions);
    socket.message('PING');
    await socket.pong();
  });

  test('connectionParams are read once from the first message and only the four credentials reach the host', async () => {
    const { socket, held, mounted } = await served({
      url: 'wss://portal.example/trpc?connectionParams=1',
    });
    // The query comes before the open resolved: it is answered after it, in order.
    socket.message(
      JSON.stringify({
        method: 'connectionParams',
        data: { token: 'abc', tenant: 'acme', traceparent: 'x', other: 1 },
      }),
    );
    socket.message(queryMessage(1));
    socket.message(queryMessage(2));
    const first = await socket.sentFor(1);
    await socket.sentFor(2);
    expect(held.opened).toEqual([{ token: 'abc', tenant: 'acme' }]);
    expect(first[0]).toMatchObject({ id: 1, result: { type: 'data' } });
    expect(mounted.calls).toHaveLength(2);
    expect(mounted.calls.every((call) => call.traceparent === undefined)).toBe(true);
    const order = socket.sent.map((message) => (message === 'PONG' ? 0 : message.id));
    expect(order).toEqual([1, 2]);
    socket.message(JSON.stringify({ method: 'connectionParams', data: { token: 'other' } }));
    await vi.waitFor(() => expect(socket.sent.length).toBeGreaterThan(2), waitOptions);
    expect(held.opened).toHaveLength(1);
    const lastMessage = socket.sent.at(-1);
    expect(lastMessage === 'PONG' ? undefined : lastMessage?.error).toBeDefined();
  });

  test.each([
    ['that is no JSON', 'not json'],
    ['with another method', JSON.stringify({ method: 'query', data: {} })],
    ['whose data is an array', JSON.stringify({ method: 'connectionParams', data: [] })],
    ['whose token is a number', JSON.stringify({ method: 'connectionParams', data: { token: 1 } })],
  ])('a first message %s closes 4000 protocol_error and opens nothing', async (_name, text) => {
    const { socket, held } = await served({ url: 'wss://portal.example/trpc?connectionParams=1' });
    socket.message(text);
    await vi.waitFor(
      () => expect(socket.closedWith).toEqual({ code: 4000, reason: 'protocol_error' }),
      waitOptions,
    );
    expect(held.opened).toEqual([]);
  });

  test('a refused open serves nothing', async () => {
    const { socket, held, mounted } = await served({ connection: { refuseOpen: true } });
    await vi.waitFor(() => expect(held.opened).toEqual([{}]), waitOptions);
    socket.message(queryMessage(1));
    socket.message('PING');
    await held.openSettled;
    await new Promise((resolve) => setImmediate(resolve));
    expect(socket.sent).toEqual([]);
    expect(mounted.calls).toEqual([]);
  });

  test('a query runs and answers as the tRPC protocol does', async () => {
    const { socket } = await served();
    socket.message(queryMessage(1));
    const [answer] = await socket.sentFor(1);
    expect(answer).toMatchObject({ id: 1, result: { type: 'data' } });
  });

  test('a command over the socket is refused core.unsupported and reaches no invoker', async () => {
    const { socket, mounted } = await served();
    socket.message(
      JSON.stringify({
        id: 1,
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
    const [answer] = await socket.sentFor(1);
    expect(keelwerkOf(answer)).toMatchObject({ code: 'core.unsupported' });
    expect(mounted.calls).toEqual([]);
  });

  test('an action with a cookie hint is refused core.unsupported, a query and a command alike', async () => {
    const hint = {
      hints: { http: { cookie: { set: { name: '__Host-session', from: 'token' } } } },
    };
    const surface = trpcSurfaceWith(
      trpcSurfaceWith(trpcConformanceSurface(), hint, 'library.findByIsbn'),
      hint,
      'loans.lend',
    );
    const { socket, mounted } = await served({ surface });
    socket.message(queryMessage(1));
    socket.message(
      JSON.stringify({
        id: 2,
        method: 'mutation',
        params: {
          path: 'loans.lend',
          input: envelope({ bookTitle: 'x', dueAt: Temporal.Instant.from('2026-12-01T00:00:00Z') }),
        },
      }),
    );
    const [queried] = await socket.sentFor(1);
    const [commanded] = await socket.sentFor(2);
    expect(keelwerkOf(queried)).toMatchObject({
      code: 'core.unsupported',
      message: 'This action sets a cookie and is not available over a socket.',
    });
    expect(keelwerkOf(commanded)).toMatchObject({ code: 'core.unsupported' });
    expect(mounted.calls).toEqual([]);
  });

  test('every query and subscription runs the session check first, and a session that does not hold is refused core.unavailable unrun', async () => {
    const holds = await served();
    holds.socket.message(queryMessage(1));
    holds.socket.message(subscriptionMessage(2));
    await holds.socket.sentFor(1);
    await holds.socket.sentFor(2, 2);
    expect(holds.held.checks.count).toBe(2);

    const broken = await served({ connection: { holds: false } });
    broken.socket.message(queryMessage(1));
    broken.socket.message(subscriptionMessage(2));
    const [queried] = await broken.socket.sentFor(1);
    const subscribed = await broken.socket.errorFor(2);
    expect(keelwerkOf(queried)).toMatchObject({ code: 'core.unavailable' });
    expect(keelwerkOf(subscribed)).toMatchObject({ code: 'core.unavailable' });
    expect(broken.mounted.calls).toEqual([]);
    expect(broken.mounted.subscribed).toEqual([]);
    expect(broken.held.slots).toEqual([]);
  });

  test("a call runs as the socket's current session, not the upgrade's", async () => {
    const { socket, held, mounted } = await served();
    await vi.waitFor(() => expect(held.opened).toHaveLength(1), waitOptions);
    const replaced = trpcSession({
      scope: { level: 'tenant', backendId: 'b2', tenantId: 't2' },
    });
    held.replace(replaced);
    socket.message(queryMessage(1));
    await socket.sentFor(1);
    expect(mounted.calls[0]?.session).toBe(replaced);
  });

  test('a subscription takes one slot, ends with its signal, and gives it back once however it ends', async () => {
    // Stopped by the client.
    const stopped = await served();
    stopped.socket.message(subscriptionMessage(1));
    await stopped.socket.sentFor(1, 2);
    expect(stopped.held.slots.map((slot) => slot.released)).toEqual([0]);
    stopped.socket.message(JSON.stringify({ id: 2, method: 'subscription.stop' }));
    stopped.socket.message(JSON.stringify({ id: 1, method: 'subscription.stop' }));
    await vi.waitFor(
      () => expect(stopped.held.slots.map((slot) => slot.released)).toEqual([1]),
      waitOptions,
    );

    // The source fails.
    const failing = await served({
      subscribe: async function* () {
        yield { control: 'head', state: headState } as LiveFrame<unknown>;
        throw new Error('source failed');
      },
    });
    failing.socket.message(subscriptionMessage(1));
    await vi.waitFor(
      () => expect(failing.held.slots.map((slot) => slot.released)).toEqual([1]),
      waitOptions,
    );

    // The socket closes while it runs.
    const closing = await served();
    closing.socket.message(subscriptionMessage(1));
    await closing.socket.sentFor(1, 2);
    closing.socket.close(1001, 'going_away');
    await vi.waitFor(
      () => expect(closing.held.slots.map((slot) => slot.released)).toEqual([1]),
      waitOptions,
    );

    // The host aborts the slot.
    const aborted = await served();
    aborted.socket.message(subscriptionMessage(1));
    await aborted.socket.sentFor(1, 2);
    aborted.held.slots[0]?.abort.abort();
    await vi.waitFor(
      () => expect(aborted.held.slots.map((slot) => slot.released)).toEqual([1]),
      waitOptions,
    );
  });

  test('a subscription refused a slot is an error on its id and reaches no invoker', async () => {
    const { socket, mounted } = await served({ connection: { refuseSlot: true } });
    socket.message(subscriptionMessage(1));
    const answer = await socket.errorFor(1);
    expect(keelwerkOf(answer)).toMatchObject({ code: 'core.quota_exceeded' });
    expect(mounted.subscribed).toEqual([]);
  });

  test('a subscription that fails unauthenticated asks for the session check', async () => {
    const { socket, held } = await served({
      subscribe: async function* () {
        yield* [] as LiveFrame<unknown>[];
        const { coreError } = await import('@keelwerk/core/http');
        throw coreError('core.unauthenticated');
      },
    });
    socket.message(subscriptionMessage(1));
    await vi.waitFor(() => expect(held.checks.count).toBe(2), waitOptions);
  });

  test('a frame of 21 calls is refused per id and runs none', async () => {
    const { socket, mounted } = await served();
    socket.message(
      JSON.stringify(Array.from({ length: 21 }, (_, index) => JSON.parse(queryMessage(index + 1)))),
    );
    await socket.sentFor(1);
    await socket.sentFor(21);
    expect(mounted.calls).toEqual([]);
    expect(socket.sent).toHaveLength(21);
  });

  test('a session on a version without a mount closes 1011 and logs its code, never its credentials', async () => {
    const { socket, mounted } = await served({
      url: 'wss://portal.example/trpc?connectionParams=1',
      connection: { session: trpcSession({ apiVersion: '1999-01-01' }) },
      surfaces: versionProjection(['2026-11-11'], () => trpcConformanceSurface()),
    });
    socket.message(JSON.stringify({ method: 'connectionParams', data: { token: 'secret-token' } }));
    await vi.waitFor(
      () => expect(socket.closedWith).toEqual({ code: 1011, reason: 'internal_error' }),
      waitOptions,
    );
    const logged = JSON.stringify(mounted.lines);
    expect(logged).toContain('The tRPC socket failed.');
    expect(logged).not.toContain('secret-token');
  });

  test('an error carries data.keelwerk with the audience of the session', async () => {
    const { socket } = await served({
      respond: () => ({
        ok: false,
        error: {
          kind: 'internal',
          code: 'core.internal',
          message: 'secret detail',
          cause: new Error('secret cause'),
        } as never,
      }),
    });
    socket.message(queryMessage(1));
    const [answer] = await socket.sentFor(1);
    const keelwerk = keelwerkOf(answer);
    expect(keelwerk).toMatchObject({ kind: 'internal' });
    expect(JSON.stringify(answer)).not.toContain('secret');
  });
});
