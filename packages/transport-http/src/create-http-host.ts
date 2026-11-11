import { createServer, IncomingMessage, type Server } from 'node:http';
import process from 'node:process';
import { getRequestListener } from '@hono/node-server';
import { coreError } from '@keelwerk/core/http';
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
import type { OpenSseStream } from './open-sse-stream.ts';
import { operatorSocket } from './operator-socket.ts';
import { operatorSocketPath } from './operator-socket-path.ts';
import { secureOperatorSocket } from './secure-operator-socket.ts';
import type { SseHostOptions } from './sse-host-options.ts';
import { trustedProxies } from './trusted-proxies.ts';

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

/** Builds the host: mount tables, dispatcher, the TCP listener and the operator socket. */
export function createHttpHost(options: HttpHostOptions, deps: HttpHostDeps): HttpHostInstance {
  const errorCounter = deps.telemetry.meter.createCounter('keelwerk.transport.errors', {
    description: 'Errors answered by a transport, by kind and code.',
  });
  const live = liveBounds(options.live);
  const host: HostContext = {
    deps,
    maxBodyBytes: options.maxBodyBytes ?? defaultMaxBodyBytes,
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
  };
  const dispatcher = createDispatcher(host, createRequestTelemetry(deps.telemetry, errorCounter));
  const servers: Server[] = [];
  const serverFor = (socketPath?: string) =>
    createServer(
      getRequestListener((request, env) => {
        const { incoming } = env;
        return dispatcher.handle(request, {
          ...(incoming instanceof IncomingMessage && { incoming }),
          ...(socketPath !== undefined && { operatorSocket: socketPath }),
        });
      }),
    );
  return {
    route(spec, handler) {
      let table = host.mounts.get(spec.app);
      if (table === undefined) {
        table = createMountTable(spec.app);
        host.mounts.set(spec.app, table);
      }
      table.add(spec, handler);
    },
    upgrade() {
      throw coreError('core.live_unavailable');
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
      const stopped = servers.splice(0).map((server) => closing(server, deadlineMs));
      await host.lifecycle.drain(deadlineMs);
      await Promise.all([...goodbyes, ...stopped]);
    },
  };
}
