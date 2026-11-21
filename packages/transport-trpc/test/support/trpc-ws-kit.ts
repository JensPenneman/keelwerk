import type { Clock } from '@keelwerk/core';
import {
  type ConnectOptions,
  type LoggedLine,
  type PinnedLiveTimers,
  pinnedLiveTimers,
  recordingLogger,
  type SocketUpgrade,
  startTransportRuntime,
  type TestSocket,
  type TransportRuntime,
  type TransportRuntimeOptions,
} from '@keelwerk/testing';
import { type HttpHostOptions, httpHost } from '@keelwerk/transport-http';
import { trpcConformanceApp } from './trpc-conformance-app.ts';

const start = Temporal.Instant.from('2026-11-12T12:00:00Z');

/** One message of tRPC's socket protocol as a test reads it. */
type TrpcWsMessage = Readonly<Record<string, unknown>> | 'PONG';

/** A runtime of the conformance app with a pinned clock and timers, a listening host and `trpc: { websocket }` on. */
export interface TrpcWsRuntime {
  readonly runtime: TransportRuntime;
  readonly timers: PinnedLiveTimers;
  readonly lines: LoggedLine[];
  /** The runtime's clock now: it moves with every `advance`, and a runtime outlives its cases. */
  now(): Temporal.Instant;
  /** Moves the clock `ms` forward and fires what is due, twice: a wait that was set by the first firing is due too. */
  advance(ms: number): Promise<void>;
  /** Opens a socket on tenant `acme` (or the named one) through the real upgrade path. */
  connect(over?: {
    readonly headers?: Record<string, string>;
    readonly tenant?: string;
    readonly path?: string;
    readonly options?: ConnectOptions;
    readonly protocol?: string | null;
  }): Promise<SocketUpgrade>;
}

/** Starts the conformance app on a pinned clock; `host` adds to the loopback-trusting listening host. */
export async function startTrpcWsRuntime(
  host: HttpHostOptions = {},
  over: Partial<Pick<TransportRuntimeOptions, 'config' | 'tenants' | 'tenantApiVersions'>> = {},
): Promise<TrpcWsRuntime> {
  let now = start;
  const clock: Clock = { now: () => now };
  const timers = pinnedLiveTimers(clock);
  const lines: LoggedLine[] = [];
  const runtime = await startTransportRuntime({
    app: trpcConformanceApp,
    host: httpHost({ listen: { port: 0 }, trustedProxies: ['127.0.0.1'], ...host }),
    config: { trpc: { cors: [], websocket: true } },
    clock,
    timers,
    logger: recordingLogger(lines),
    ...over,
  });
  return {
    runtime,
    timers,
    lines,
    now: () => now,
    advance: async (ms) => {
      now = now.add({ milliseconds: ms });
      await timers.fire();
      await timers.fire();
    },
    connect: async (given = {}) => {
      if (runtime.connect === undefined) throw new Error('the runtime has no connect hook');
      const domain = runtime.domains[given.tenant ?? 'acme'];
      const headers = new Headers(given.headers);
      if (given.protocol !== null) {
        headers.set('sec-websocket-protocol', given.protocol ?? 'keelwerk.trpc.v1');
      }
      return runtime.connect(
        new Request(`https://${domain}${given.path ?? '/trpc'}`, { headers }),
        given.options,
      );
    },
  };
}

/** The open socket of an upgrade, or a failure naming the refusal. */
export function openedTrpcSocket(upgrade: SocketUpgrade): TestSocket {
  if (upgrade.kind !== 'open') {
    throw new Error(`The upgrade was refused: ${upgrade.response.status}.`);
  }
  return upgrade.socket;
}

/** A client of tRPC's socket protocol over the suite's socket hook. */
export interface TrpcWsTestClient {
  readonly socket: TestSocket;
  send(message: unknown): void;
  /** The next message, parsed (`PONG` as it is). */
  next(ms?: number): Promise<TrpcWsMessage>;
  /** Sends `PING` and reads the `PONG`. */
  ping(): Promise<void>;
  /** Sends tRPC's first message with `data` as the connection parameters. */
  params(data: unknown): void;
  /** Sends one call. */
  call(id: number, method: string, path: string, input?: unknown, lastEventId?: string): void;
}

/** The client of an open socket. */
export function trpcWsTestClient(socket: TestSocket): TrpcWsTestClient {
  const next = async (ms?: number): Promise<TrpcWsMessage> => {
    const text = String(await socket.next(ms));
    return text === 'PONG' ? 'PONG' : (JSON.parse(text) as TrpcWsMessage);
  };
  const send = (message: unknown): void => socket.send(JSON.stringify(message));
  return {
    socket,
    send,
    next,
    ping: async () => {
      socket.send('PING');
      const answer = await next();
      if (answer !== 'PONG') throw new Error(`Expected PONG, got ${JSON.stringify(answer)}.`);
    },
    params: (data) => send({ method: 'connectionParams', data }),
    call: (id, method, path, input, lastEventId) =>
      send({
        id,
        method,
        params: {
          path,
          input,
          ...(lastEventId === undefined ? {} : { lastEventId }),
        },
      }),
  };
}

/** Node's `WebSocket` with the headers always sent beside the protocols the caller names. */
export function webSocketWithHeaders(headers: Record<string, string>): typeof WebSocket {
  return class HeaderWebSocket extends WebSocket {
    constructor(url: string | URL, offer?: ConstructorParameters<typeof WebSocket>[1]) {
      const protocols =
        offer === undefined
          ? []
          : typeof offer === 'string'
            ? [offer]
            : Array.isArray(offer)
              ? offer
              : ((Reflect.get(offer, 'protocols') as string[] | string | undefined) ?? []);
      super(url, { protocols: typeof protocols === 'string' ? [protocols] : protocols, headers });
    }
  };
}
