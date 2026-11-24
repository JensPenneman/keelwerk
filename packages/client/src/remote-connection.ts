import type { ApiSurface } from '@keelwerk/core';
import type { RetryPolicy } from './retry-policy.ts';

/** Where and as whom a remote client talks. */
export interface RemoteConnection {
  /** Without a trailing slash. */
  readonly origin: string;
  readonly apiVersion: string;
  readonly token?: string;
  readonly backend?: string;
  readonly tenant?: string;
  readonly deviceId?: string;
  readonly send: typeof fetch;
  readonly retry: RetryPolicy;
  /** The carrier of subscriptions: server-sent events (the default) or the `keelwerk.live.v1` WebSocket. */
  readonly live?: 'sse' | 'websocket';
  /** Opens the WebSocket of `live: 'websocket'`; absent: the platform `WebSocket`. */
  readonly webSocket?: (url: string, protocols: readonly string[]) => WebSocket;
  /** The committed surface artefact, which saves the request. */
  readonly committed?: ApiSurface;
}
