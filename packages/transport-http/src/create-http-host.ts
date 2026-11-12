import { createServer, IncomingMessage, type Server } from 'node:http';
import process from 'node:process';
import { getRequestListener } from '@hono/node-server';
import { WebSocketServer } from 'ws';
import { createDispatcher } from './create-dispatcher.ts';
import { createLifecycle } from './create-lifecycle.ts';
import { createMountTable } from './create-mount-table.ts';
import { createRequestTelemetry } from './create-request-telemetry.ts';
import { createStreamLimits } from './create-stream-limits.ts';
import { defaultMaxBodyBytes } from './default-max-body-bytes.ts';
import type { HostContext } from './host-context.ts';
import { hostFetch } from './host-fetch.ts';
import type { HttpHostDeps } from './http-host-deps.ts';
import type { HttpHostInstance } from './http-host-instance.ts';
import type { HttpHostOptions } from './http-host-options.ts';
import type { LiveSocketHostOptions } from './live-socket-host-options.ts';
import type { OpenLiveSocket } from './open-live-socket.ts';
import type { OpenSseStream } from './open-sse-stream.ts';
import { operatorSocket } from './operator-socket.ts';
import { operatorSocketPath } from './operator-socket-path.ts';
import { registerUpgrade } from './register-upgrade.ts';
import { secureOperatorSocket } from './secure-operator-socket.ts';
import type { SseHostOptions } from './sse-host-options.ts';
import { trustedProxies } from './trusted-proxies.ts';
import { upgradeListener } from './upgrade-listener.ts';
import type { UpgradeRegistration } from './upgrade-registration.ts';
import { upgradeTable } from './upgrade-table.ts';

function listening(server: Server, start: (done: () => void) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    start(() => {
      server.off('error', reject);
      resolve();
    });
  });
}

function closing(server: Server, deadlineMs: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(
      () => {
        server.closeAllConnections();
      },
      Math.max(0, deadlineMs),
    );
    server.close(() => {
      clearTimeout(timer);
      resolve();
    });
    server.closeIdleConnections();
  });
}

/** The bounds of a stream with their defaults (15.4.5, 15.4.10). */
function liveBounds(given: SseHostOptions = {}): Required<SseHostOptions> {
  return {
    heartbeatMs: given.heartbeatMs ?? 15_000,
    maxDurationMs: given.maxDurationMs ?? 86_400_000,
    maxBufferedBytes: given.maxBufferedBytes ?? 1_048_576,
    stallMs: given.stallMs ?? 30_000,
    maxStreamsPerPrincipal: given.maxStreamsPerPrincipal ?? 20,
    maxStreamsPerTenant: given.maxStreamsPerTenant ?? 1000,
    maxAnonymousStreamsPerTenant: given.maxAnonymousStreamsPerTenant ?? 200,
    maxStreams: given.maxStreams ?? 10_000,
  };
}

/** The bounds of a `keelwerk.live.v1` socket with their defaults (15.4.5, 15.4.7, 15.4.10). */
function liveSocketBounds(
  given: LiveSocketHostOptions | undefined,
  maxBodyBytes: number,
): Required<LiveSocketHostOptions> {
  return {
    heartbeatMs: given?.heartbeatMs ?? 30_000,
    pongTimeoutMs: given?.pongTimeoutMs ?? 10_000,
    helloTimeoutMs: given?.helloTimeoutMs ?? 10_000,
    maxSubscriptionsPerSocket: given?.maxSubscriptionsPerSocket ?? 100,
    maxMessageBytes: given?.maxMessageBytes ?? maxBodyBytes,
    maxMessagesPerWindow: given?.maxMessagesPerWindow ?? 200,
    messageWindowMs: given?.messageWindowMs ?? 10_000,
    maxPendingInvokes: given?.maxPendingInvokes ?? 32,
    revalidateMs: given?.revalidateMs ?? 60_000,
  };
}

/** Builds the host: mount tables, dispatcher, the TCP listener and the operator socket. */
export function createHttpHost(options: HttpHostOptions, deps: HttpHostDeps): HttpHostInstance {
  const errorCounter = deps.telemetry.meter.createCounter('keelwerk.transport.errors', {
    description: 'Errors answered by a transport, by kind and code.',
  });
  const live = liveBounds(options.live);
  const maxBodyBytes = options.maxBodyBytes ?? defaultMaxBodyBytes;
  const liveSocket = liveSocketBounds(options.liveSocket, maxBodyBytes);
  const host: HostContext = {
    deps,
    maxBodyBytes,
    proxies: trustedProxies(options.trustedProxies ?? []),
    mounts: new Map(),
    connectionIds: new WeakMap(),
    lifecycle: createLifecycle(),
    errorCounter,
    streams: new Set<OpenSseStream>(),
    limits: createStreamLimits({
      perPrincipal: live.maxStreamsPerPrincipal,
      perTenant: live.maxStreamsPerTenant,
      perTenantAnonymous: live.maxAnonymousStreamsPerTenant,
      total: live.maxStreams,
    }),
    live,
    sockets: new Set<OpenLiveSocket>(),
    upgrades: new Map<string, UpgradeRegistration[]>(),
    liveSocket,
    // Compression is off: compressed frames would put session tokens and masked rows beside
    // attacker-chosen data (CRIME and BREACH), and inflation costs memory for every socket.
    webSockets: new WebSocketServer({
      noServer: true,
      clientTracking: false,
      perMessageDeflate: false,
      maxPayload: liveSocket.maxMessageBytes,
      // ws would answer every client ping at once and write it however full the socket is: the
      // connection answers pings itself, counted and bounded.
      autoPong: false,
    }),
  };
  const dispatcher = createDispatcher(host, createRequestTelemetry(deps.telemetry, errorCounter));
  const servers: Server[] = [];
  const serverFor = (socketPath?: string) => {
    const server = createServer(
      // Only a WebSocket upgrade goes to the upgrade listener; others (h2c) are served as requests.
      {
        shouldUpgradeCallback: (request) => request.headers.upgrade?.toLowerCase() === 'websocket',
      },
      getRequestListener((request, env) => {
        const { incoming } = env;
        return dispatcher.handle(request, {
          ...(incoming instanceof IncomingMessage && { incoming }),
          ...(socketPath !== undefined && { operatorSocket: socketPath }),
        });
      }),
    );
    server.on('upgrade', upgradeListener(dispatcher, host, socketPath));
    return server;
  };
  return {
    route(spec, handler) {
      let table = host.mounts.get(spec.app);
      if (table === undefined) {
        table = createMountTable(spec.app);
        host.mounts.set(spec.app, table);
      }
      table.add(spec, handler);
    },
    upgrade(spec, handler) {
      registerUpgrade(host.upgrades, upgradeTable, spec, handler);
    },
    fetch: hostFetch(dispatcher),
    async listen() {
      let port: number | undefined;
      let bound: string | undefined;
      if (options.listen !== undefined) {
        const server = serverFor();
        servers.push(server);
        const { port: wanted, hostname = '127.0.0.1' } = options.listen;
        await listening(server, (done) => server.listen(wanted, hostname, done));
        const address = server.address();
        port = typeof address === 'object' && address !== null ? address.port : wanted;
      }
      const configured = deps.operator?.socket;
      if (configured !== undefined) {
        const uid = process.getuid?.() ?? 0;
        bound = operatorSocketPath(configured, uid, deps.operator?.fallbackDirectory);
        await operatorSocket(bound, uid);
        const server = serverFor(bound);
        servers.push(server);
        const path = bound;
        await listening(server, (done) => server.listen(path, done));
        await secureOperatorSocket(path);
      }
      return {
        ...(port !== undefined && { port }),
        ...(bound !== undefined && { operatorSocket: bound }),
      };
    },
    async stop(deadlineMs) {
      // First, synchronously, so no stream outlives the stop silently: each ends `going_away` and its
      // subscription is aborted, before the hubs close and before the listeners wait for connections.
      const goodbyes = [...host.streams].map((stream) => stream.goAway().catch(() => undefined));
      // The sockets close 1001 in the same turn; an upgraded socket is no longer the server's to close,
      // so whatever has not answered by the deadline is terminated here.
      const sockets = [...host.sockets];
      for (const socket of sockets) socket.goAway();
      const cut = setTimeout(
        () => {
          for (const socket of sockets) socket.terminate();
        },
        Math.max(0, deadlineMs),
      );
      cut.unref();
      const stopped = servers.splice(0).map((server) => closing(server, deadlineMs));
      await host.lifecycle.drain(deadlineMs);
      // An upgrade still in dispatch may have completed its handshake during the drain.
      const late = [...host.sockets].filter((socket) => !sockets.includes(socket));
      for (const socket of late) socket.goAway();
      sockets.push(...late);
      await Promise.all([...goodbyes, ...stopped, ...sockets.map((socket) => socket.closed)]);
      clearTimeout(cut);
      host.webSockets.close();
    },
  };
}
