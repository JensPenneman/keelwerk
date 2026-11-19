import type { ApiSurface } from '@keelwerk/core';
import type { RetryPolicy } from './retry-policy.ts';

/** What `createRemoteClient` takes (section 16.8.4). */
export interface RemoteClientOptions {
  /** 'https://lvj.example' or 'unix:///run/keelwerk/operator.sock'; a `unix://` URL needs `fetch` from `@keelwerk/client/unix-socket`. */
  readonly url: string;
  /** The head the types were compiled with, exported by the generated file; sent as `Keelwerk-Version`. */
  readonly apiVersion: string;
  readonly token?: string;
  readonly backend?: string;
  readonly tenant?: string;
  readonly fetch?: typeof fetch;
  /** The committed surface artefact of `apiVersion`; without it the client fetches `GET /surface` once. */
  readonly surface?: ApiSurface;
  /** Replaces members of the default retry policy. */
  readonly retry?: Partial<RetryPolicy>;
  /** The carrier of subscriptions: `'sse'` (the default, which works over `fetch` and `unix://`) or `'websocket'`. */
  readonly live?: 'sse' | 'websocket';
  /** Opens the socket of `live: 'websocket'`, for a runtime whose `WebSocket` needs headers or another constructor; default the platform `WebSocket`. */
  readonly webSocket?: (url: string, protocols: readonly string[]) => WebSocket;
  /** A client-chosen device id, sent as `Keelwerk-Client-Id`. */
  readonly deviceId?: string;
}
