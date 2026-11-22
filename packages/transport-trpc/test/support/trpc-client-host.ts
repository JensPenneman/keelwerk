import { renderTypeId } from '@keelwerk/core';
import {
  pinnedTransportClock,
  requestHeaders,
  startTransportRuntime,
  transportTargetOf,
} from '@keelwerk/testing';
import { httpHost } from '@keelwerk/transport-http';
import {
  createTRPCClient,
  createWSClient,
  httpBatchLink,
  httpSubscriptionLink,
  splitLink,
  wsLink,
} from '@trpc/client';
import { EventSource } from 'eventsource';
import { trpcWebSocket } from '../../src/client/trpc-web-socket.ts';
import { keelwerkSuperjson } from '../../src/transformer/keelwerk-superjson.ts';
import { trpcCodec } from './trpc-codec.ts';
import { trpcConformanceApp } from './trpc-conformance-app.ts';
import type { TrpcRouter } from './trpc-conformance-router.ts';
import { webSocketWithHeaders } from './trpc-ws-kit.ts';
import { withTokenResolver } from './with-token-resolver.ts';

/**
 * `base`, refused while the gate is shut: the attempt goes to `refusedUrl`, a path the host does not
 * serve, so the refusal is an answer of the server and reaches the client in a later turn of the event
 * loop than the one that made the socket. Port 1 would not do: it is on the fetch standard's list of
 * blocked ports, so Node's WebSocket fails before any connection, and its `error` and `close` come
 * before the listeners that tRPC's client adds two microtasks after it made the socket; tRPC's open
 * then never settles and the client makes no second attempt (the gate test of trpc-client-socket.test.ts
 * pins this).
 */
function gated(
  base: typeof WebSocket,
  gate: { open: boolean } | undefined,
  refusedUrl: string,
): typeof WebSocket {
  if (gate === undefined) return base;
  const shut = gate;
  return class GatedWebSocket extends base {
    constructor(url: string | URL, offer?: ConstructorParameters<typeof WebSocket>[1]) {
      super(shut.open ? url : refusedUrl, offer);
    }
  };
}

/** The conformance app served by the real host on a port, and the clients of `@trpc/client` that call it in-process. */
export async function trpcClientHost(options: { readonly websocket?: boolean } = {}) {
  const clock = pinnedTransportClock(Temporal.Instant.from('2026-11-12T12:00:00Z'));
  const runtime = await startTransportRuntime({
    app: withTokenResolver(trpcConformanceApp),
    host: httpHost({
      listen: { port: 0 },
      trustedProxies: ['127.0.0.1'],
      live: { maxStreamsPerPrincipal: 2 },
    }),
    config: options.websocket === true ? { trpc: { cors: [], websocket: true } } : {},
    tenants: ['acme'],
    clock: clock.clock,
    timers: clock.timers,
  });
  const target = transportTargetOf(runtime, trpcCodec, [], true, clock.advance);
  const domain = target.tenants.acme?.domain ?? '';
  const url = `https://${domain}/trpc`;
  const tenantId = runtime.tenants.acme ?? '';
  /** The socket URL of the loopback listener, with the tenant named by its path as a browser client without a domain would. */
  const socketUrl = `ws://127.0.0.1:${runtime.runtime.port}/t/${renderTypeId('tnt', tenantId)}/trpc`;

  /** A path of the loopback listener that no endpoint serves: the host answers the upgrade with an error. */
  const refusedUrl = `ws://127.0.0.1:${runtime.runtime.port}/refused`;

  /** The host's own fetch, with the principal of the subject: a client in the test runs in-process. */
  function hostFetch(subject: string, more: Record<string, string> = {}) {
    return async (
      input: string | URL | Request,
      init?: RequestInit | undefined,
    ): Promise<Response> => {
      const request = new Request(input, init);
      for (const [name, value] of requestHeaders({ subject })) request.headers.set(name, value);
      for (const [name, value] of Object.entries(more)) request.headers.set(name, value);
      return await target.fetch(request);
    };
  }

  function clientOf(subject: string, more: Record<string, string> = {}) {
    return clientWith(hostFetch(subject, more));
  }

  function clientWith(fetchWith: ReturnType<typeof hostFetch>) {
    const transformer = keelwerkSuperjson();
    return createTRPCClient<TrpcRouter>({
      links: [
        splitLink({
          condition: (operation) => operation.type === 'subscription',
          true: httpSubscriptionLink({
            url,
            transformer,
            // biome-ignore lint/style/useNamingConvention: the option is tRPC's own name
            EventSource: EventSource as never,
            eventSourceOptions: () => ({ fetch: fetchWith }) as never,
          }),
          false: httpBatchLink({ url, transformer, fetch: fetchWith as never }),
        }),
      ],
    });
  }

  /** A client whose queries and subscriptions run over one socket as the subject (anonymous without one); `close` ends the socket. */
  function socketClientOf(
    subject: string | undefined,
    retryDelayMs = (): number => 50,
    on: {
      readonly onOpen?: () => void;
      readonly onClose?: () => void;
      /** While `open` is false every connection attempt goes to a path the host refuses (see `gated`). */
      readonly gate?: { open: boolean };
    } = {},
  ) {
    const headers: Record<string, string> = {};
    if (subject !== undefined) {
      for (const [name, value] of requestHeaders({ subject })) headers[name] = value;
    }
    const socket = createWSClient({
      url: socketUrl,
      // biome-ignore lint/style/useNamingConvention: the option is tRPC's own name
      WebSocket: trpcWebSocket(gated(webSocketWithHeaders(headers), on.gate, refusedUrl)),
      retryDelayMs,
      ...(on.onOpen === undefined ? {} : { onOpen: on.onOpen }),
      ...(on.onClose === undefined ? {} : { onClose: on.onClose }),
    });
    const client = createTRPCClient<TrpcRouter>({
      links: [wsLink({ client: socket, transformer: keelwerkSuperjson() })],
    });
    return { client, close: () => socket.close() };
  }
  /**
   * A client whose socket carries no header and no cookie: its credentials are the `token` of tRPC's
   * `connectionParams`, sent as the first message. A refused token closes the socket 4401; the client
   * waits a minute before it would connect again, so only `close` ends what it does after that.
   * `closed` settles with the code of the first close the client sees: a case awaits that signal and
   * makes no call, because tRPC fails such a call only if it tried to send it before it handled the close
   * (sent, or refused by a socket already closing); a call still waiting to be sent when the close is
   * handled is kept for the next connection.
   */
  function tokenSocketClientOf(token: string) {
    const closed = Promise.withResolvers<number>();
    const socket = createWSClient({
      url: socketUrl,
      // biome-ignore lint/style/useNamingConvention: the option is tRPC's own name
      WebSocket: trpcWebSocket(WebSocket),
      connectionParams: { token },
      retryDelayMs: () => 60_000,
      onClose: (event) => closed.resolve(event?.code ?? 0),
    });
    const client = createTRPCClient<TrpcRouter>({
      links: [wsLink({ client: socket, transformer: keelwerkSuperjson() })],
    });
    return { client, closed: closed.promise, close: () => socket.close() };
  }
  /** The socket class a client uses while `gate` is shut: its attempts go to the path the host refuses. */
  const gatedWebSocket = (gate: { open: boolean }): typeof WebSocket =>
    gated(webSocketWithHeaders({}), gate, refusedUrl);
  return {
    url,
    socketUrl,
    gatedWebSocket,
    hostFetch,
    clientOf,
    clientWith,
    socketClientOf,
    tokenSocketClientOf,
    advance: clock.advance,
    stop: () => runtime.stop(),
  };
}
