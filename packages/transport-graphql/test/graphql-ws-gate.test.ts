import type { HttpContext, LiveFrame, SocketSession, StateToken } from '@keelwerk/core';
import { coreError } from '@keelwerk/core/http';
import { freshName } from '@keelwerk/testing';
import { afterAll, describe, expect, test, vi } from 'vitest';
import {
  conformanceSurface,
  type GraphqlSubscribe,
  graphqlRequestId,
  graphqlSession,
  mountedGraphql,
} from './support/graphql-kit.ts';
import { graphqlWsClient, openedSocket, startWsRuntime } from './support/graphql-ws-client.ts';

const ticker = 'subscription { loansLoanTicker { __typename ... on StreamHead { state } } }';

/** A web socket the handler can drive: what it sends and how it was closed are recorded. */
class FakeSocket extends EventTarget {
  readonly protocol = 'graphql-transport-ws';
  readonly sent: { type: string; id?: string; payload?: unknown }[] = [];
  closedWith: { code: number | undefined; reason: string | undefined } | undefined;
  send(data: string): void {
    this.sent.push(JSON.parse(data));
  }
  close(code?: number, reason?: string): void {
    if (this.closedWith !== undefined) return;
    this.closedWith = { code, reason };
    this.dispatchEvent(new CloseEvent('close', { code: code ?? 1000, reason: reason ?? '' }));
  }
  message(value: unknown): void {
    this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(value) }));
  }
  /** The next message of `type` the handler sent. */
  async sentOf(type: string): Promise<{ type: string; id?: string; payload?: unknown }> {
    return vi.waitFor(
      () => {
        const found = this.sent.find((message) => message.type === type);
        if (found === undefined) {
          throw new Error(`No ${type} message was sent: ${JSON.stringify(this.sent)}.`);
        }
        return found;
      },
      { timeout: 2_000, interval: 5 },
    );
  }
}

/** A host session of a socket that records what the handler asked of it. */
function fakeConnection(over: { readonly refuseSlot?: boolean } = {}) {
  const opened: unknown[] = [];
  const slots: { id: string; released: number; abort: AbortController }[] = [];
  const session = graphqlSession();
  const connection: SocketSession = {
    session: () => session,
    carrier: () => ({ transport: 'http', host: 'portal.example', path: '/graphql', headers: {} }),
    open: async (credentials) => {
      opened.push(credentials);
      return { ok: true, value: session };
    },
    maxMessageBytes: 1_048_576,
    // GraphQL sockets run only subscriptions and take no call slot.
    invocation: () => ({ release: () => undefined }),
    subscription: (id) => {
      if (over.refuseSlot === true) throw coreError('core.quota_exceeded');
      const slot = { id, released: 0, abort: new AbortController() };
      slots.push(slot);
      return {
        signal: slot.abort.signal,
        release: () => {
          slot.released += 1;
        },
      };
    },
    check: async () => true,
    signal: new AbortController().signal,
  };
  return { connection, opened, slots };
}

const httpContext: HttpContext = {
  session: graphqlSession(),
  carrier: { transport: 'http', host: 'portal.example', path: '/graphql', headers: {} },
  requestId: graphqlRequestId,
  signal: new AbortController().signal,
  path: '/',
  basePath: '',
};

/** The graphql-ws handler the adapter registers, driven through a fake socket and a fake host session. */
async function opened(
  subscribe: GraphqlSubscribe | undefined,
  over: Parameters<typeof fakeConnection>[0] = {},
) {
  const mounted = await mountedGraphql(
    conformanceSurface(),
    () => ({ ok: true, value: undefined }),
    {
      config: { websocket: true },
      ...(subscribe === undefined ? {} : { subscribe }),
    },
  );
  const handler = mounted.upgraded[0]?.handler;
  if (handler === undefined) throw new Error('the adapter registered no upgrade');
  const socket = new FakeSocket();
  const held = fakeConnection(over);
  handler.open(socket as unknown as WebSocket, httpContext, held.connection);
  socket.message({ type: 'connection_init', payload: { token: 'abc', other: 1 } });
  await socket.sentOf('connection_ack');
  return { socket, mounted, ...held };
}

/** A stream that yields its head and then waits for the invocation to be aborted, as the hub's iterator does. */
const head: GraphqlSubscribe = (inv) =>
  (async function* (): AsyncGenerator<LiveFrame<unknown>> {
    yield { control: 'head', state: 'v2.a' as StateToken };
    await new Promise<void>((done) => {
      if (inv.signal?.aborted === true) done();
      else inv.signal?.addEventListener('abort', () => done(), { once: true });
    });
  })();

describe('the graphql-ws handler over the host session', () => {
  test('registers graphql-transport-ws on the path of the route, and refuses a backend without websocket', async () => {
    const mounted = await mountedGraphql(conformanceSurface(), () => ({
      ok: true,
      value: undefined,
    }));
    expect(mounted.upgraded).toMatchObject([
      { path: '/graphql', protocols: ['graphql-transport-ws'] },
    ]);
    const refusal = mounted.upgraded[0]?.handler.refuse?.(httpContext);
    expect(refusal).toMatchObject({ code: 'core.not_found', kind: 'not_found' });
    const on = await mountedGraphql(conformanceSurface(), () => ({ ok: true, value: undefined }), {
      config: { websocket: true },
    });
    expect(on.upgraded[0]?.handler.refuse?.(httpContext)).toBeUndefined();
  });

  test('reads the credentials of connection_init once and hands the host the four it knows', async () => {
    const { opened: calls } = await opened(undefined);
    expect(calls).toEqual([{ token: 'abc' }]);
  });

  test('a subscription over the limits is an error message on its id and reaches no invoker', async () => {
    // Remove the `prepareDocuments(...)` call in graphql-ws-handler.ts: the document reaches the invoker.
    const { socket, mounted, slots } = await opened(head);
    const aliases = Array.from({ length: 31 }, (_, index) => `a${index}: __typename`).join(' ');
    socket.message({
      id: '1',
      type: 'subscribe',
      payload: { query: `subscription { loansLoanTicker { ${aliases} } }` },
    });
    const answer = await socket.sentOf('error');
    expect(answer.id).toBe('1');
    expect(JSON.stringify(answer.payload)).toContain('core.validation');
    expect(mounted.subscribed).toEqual([]);
    expect(slots).toEqual([]);
  });

  test('a subscription refused a slot is an error message on its id and reaches no invoker', async () => {
    const { socket, mounted } = await opened(head, { refuseSlot: true });
    socket.message({ id: '1', type: 'subscribe', payload: { query: ticker } });
    const answer = await socket.sentOf('error');
    expect(JSON.stringify(answer.payload)).toContain('core.quota_exceeded');
    expect(mounted.subscribed).toEqual([]);
  });

  test('every slot is released once: on complete, on error, on close', async () => {
    // On complete: the client ends the stream.
    const first = await opened(head);
    first.socket.message({ id: '1', type: 'subscribe', payload: { query: ticker } });
    await first.socket.sentOf('next');
    expect(first.slots.map((slot) => slot.released)).toEqual([0]);
    first.socket.message({ id: '1', type: 'complete' });
    await vi.waitFor(() => expect(first.slots.map((slot) => slot.released)).toEqual([1]));
    first.socket.close(1000, 'bye');
    expect(first.slots.map((slot) => slot.released)).toEqual([1]);

    // On error: the stream fails, the operation ends with its error and its slot is given back.
    const failing = await opened(async function* () {
      yield { control: 'head', state: 'v2.a' as StateToken } as LiveFrame<unknown>;
      throw coreError('core.unavailable');
    });
    failing.socket.message({ id: '1', type: 'subscribe', payload: { query: ticker } });
    await failing.socket.sentOf('complete');
    expect(failing.slots.map((slot) => slot.released)).toEqual([1]);

    // On close: the socket ends while the subscription runs.
    const open = await opened(head);
    open.socket.message({ id: '1', type: 'subscribe', payload: { query: ticker } });
    await open.socket.sentOf('next');
    open.socket.close(1001, 'going_away');
    expect(open.slots.map((slot) => slot.released)).toEqual([1]);
  });
});

describe('the origin rule of a session a connection_init opens', () => {
  const origin = 'https://app.example.test';
  const kit = startWsRuntime({}, { config: { graphql: { cors: [origin], websocket: true } } });
  afterAll(async () => (await kit).runtime.stop());

  test('an origin the graphql route allows may name its tenant in connection_init; another origin is refused at the upgrade', async () => {
    // Take `state.upgrade.transport` out of the allowedOrigins call in open-socket-session.ts: the ack becomes a close with core.csrf.
    const { connect } = await kit;
    const cookie = `__Host-kw-test=user:${freshName('ada')}`;
    const allowed = await connect({
      headers: { cookie, origin, 'sec-fetch-site': 'cross-site' },
    });
    const ws = graphqlWsClient(openedSocket(allowed));
    try {
      await ws.init({ tenant: 'acme' });
    } finally {
      await ws.socket.close();
    }
    const foreign = await connect({
      headers: { cookie, origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' },
    });
    if (foreign.kind === 'open') await foreign.socket.close();
    expect(foreign.kind).toBe('refused');
    if (foreign.kind === 'refused') {
      expect(foreign.response.status).toBe(403);
      expect(await foreign.response.json()).toMatchObject({ error: { code: 'core.csrf' } });
    }
  });
});
