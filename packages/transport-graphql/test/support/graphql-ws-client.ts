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
import { graphqlConformanceApp } from './graphql-conformance-app.ts';

const start = Temporal.Instant.from('2026-11-12T12:00:00Z');

/** One message of graphql-transport-ws as a test reads it. */
export interface WsMessage {
  readonly type: string;
  readonly id?: string;
  readonly payload?: unknown;
}

/** A graphql-ws client over the suite's socket hook. */
export interface GraphqlWsClient {
  readonly socket: TestSocket;
  send(message: Record<string, unknown>): void;
  /** The next message, parsed. */
  next(ms?: number): Promise<WsMessage>;
  /** Sends `connection_init` with the parameters and reads the acknowledgement. */
  init(params?: Record<string, unknown>): Promise<void>;
  /** Sends a subscribe of the query under `id`. */
  subscribe(id: string, query: string, variables?: Record<string, unknown>): void;
}

/** A runtime of the conformance app with a pinned clock and timers, a listening host and `graphql: { websocket }` on. */
export interface WsRuntime {
  readonly runtime: TransportRuntime;
  readonly timers: PinnedLiveTimers;
  readonly lines: LoggedLine[];
  /** Moves the clock `ms` forward and fires what is due, twice: a wait that was set by the first firing is due too. */
  advance(ms: number): Promise<void>;
  /** Opens a graphql-ws socket on tenant `acme` (or the named one) through the real upgrade path. */
  connect(over?: {
    readonly headers?: Record<string, string>;
    readonly tenant?: string;
    readonly options?: ConnectOptions;
    readonly protocol?: string;
  }): Promise<SocketUpgrade>;
}

/** Starts the conformance app on a pinned clock; `host` adds to the loopback-trusting listening host. */
export async function startWsRuntime(
  host: HttpHostOptions = {},
  over: Partial<Pick<TransportRuntimeOptions, 'config' | 'tenants' | 'tenantApiVersions'>> = {},
): Promise<WsRuntime> {
  let now = start;
  const clock: Clock = { now: () => now };
  const timers = pinnedLiveTimers(clock);
  const lines: LoggedLine[] = [];
  const runtime = await startTransportRuntime({
    app: graphqlConformanceApp,
    host: httpHost({ listen: { port: 0 }, trustedProxies: ['127.0.0.1'], ...host }),
    config: { graphql: { cors: [], websocket: true } },
    clock,
    timers,
    logger: recordingLogger(lines),
    ...over,
  });
  return {
    runtime,
    timers,
    lines,
    advance: async (ms) => {
      now = now.add({ milliseconds: ms });
      await timers.fire();
      await timers.fire();
    },
    connect: async (given = {}) => {
      if (runtime.connect === undefined) throw new Error('the runtime has no connect hook');
      const domain = runtime.domains[given.tenant ?? 'acme'];
      const headers = new Headers(given.headers);
      headers.set('sec-websocket-protocol', given.protocol ?? 'graphql-transport-ws');
      return runtime.connect(new Request(`https://${domain}/graphql`, { headers }), given.options);
    },
  };
}

/** The open socket of an upgrade, or a failure naming the refusal. */
export function openedSocket(upgrade: SocketUpgrade): TestSocket {
  if (upgrade.kind !== 'open')
    throw new Error(`The upgrade was refused: ${upgrade.response.status}.`);
  return upgrade.socket;
}

/** The graphql-ws client of an open socket. */
export function graphqlWsClient(socket: TestSocket): GraphqlWsClient {
  const next = async (ms?: number): Promise<WsMessage> =>
    JSON.parse(String(await socket.next(ms))) as WsMessage;
  const send = (message: Record<string, unknown>): void => socket.send(JSON.stringify(message));
  return {
    socket,
    send,
    next,
    init: async (params) => {
      send({ type: 'connection_init', ...(params === undefined ? {} : { payload: params }) });
      const answer = await next();
      if (answer.type !== 'connection_ack') {
        throw new Error(`Expected connection_ack, got ${JSON.stringify(answer)}.`);
      }
    },
    subscribe: (id, query, variables) =>
      send({
        id,
        type: 'subscribe',
        payload: { query, ...(variables === undefined ? {} : { variables }) },
      }),
  };
}

/** The subscription of a public stream that holds a slot: `loans.loanTicker` answers a head and then nothing. */
export const tickerQuery =
  'subscription { loansLoanTicker { __typename ... on StreamHead { state } } }';

/** The subscription of the signed-in loan stream. */
export const loanEventsQuery =
  'subscription { loansLoanEvents { __typename ... on StreamHead { state } ... on LoansLoanEventsItem { kind } } }';
