import type { Meter } from '@keelwerk/core';
import type { WebSocketServer } from 'ws';
import type { HttpHostDeps } from './http-host-deps.ts';
import type { Lifecycle } from './lifecycle.ts';
import type { LiveSocketHostOptions } from './live-socket-host-options.ts';
import type { MountTable } from './mount-table.ts';
import type { OpenLiveSocket } from './open-live-socket.ts';
import type { OpenSseStream } from './open-sse-stream.ts';
import type { SseHostOptions } from './sse-host-options.ts';
import type { StreamLimits } from './stream-limits.ts';
import type { TrustedProxies } from './trusted-proxies.ts';
import type { UpgradeRegistration } from './upgrade-registration.ts';

/** What every part of one host shares; built once by `createHttpHost`. */
export interface HostContext {
  readonly deps: HttpHostDeps;
  readonly maxBodyBytes: number;
  readonly proxies: TrustedProxies;
  /** The mount table of each app. */
  readonly mounts: Map<string, MountTable>;
  /**
   * One record per socket, made when the connection opens: its id, so the requests of a keep-alive
   * connection share a connection id, and its peer address, which Node forgets once the client resets.
   */
  readonly connectionIds: WeakMap<
    object,
    { readonly id: string; readonly peer: string | undefined }
  >;
  readonly lifecycle: Lifecycle;
  readonly errorCounter: ReturnType<Meter['createCounter']>;
  /** The open server-sent event streams: `stop` says goodbye to each. */
  readonly streams: Set<OpenSseStream>;
  readonly limits: StreamLimits;
  /** The bounds of a stream with their defaults filled in. */
  readonly live: Required<SseHostOptions>;
  /** The open `keelwerk.live.v1` sockets: `stop` says goodbye to each. */
  readonly sockets: Set<OpenLiveSocket>;
  /** What transports registered through `upgrade`, by app. */
  readonly upgrades: Map<string, UpgradeRegistration[]>;
  /** The bounds of a socket with their defaults filled in. */
  readonly liveSocket: Required<LiveSocketHostOptions>;
  /** The one WebSocket server of the host: it only completes handshakes the host accepted. */
  readonly webSockets: WebSocketServer;
}
