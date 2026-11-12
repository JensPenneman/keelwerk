import type { HostFetchOptions } from '@keelwerk/core';
import type { TransportCodec } from './transport-codec.ts';

/** What the suite runs against: a request function, a codec and the deployment's tenants. */
export interface TransportTarget {
  /** The name shown in the test titles. */
  readonly name: string;
  /**
   * The host's dispatch: `runtime.host.fetch`, or `fetch` against a listening port. Each request
   * comes from its own client address unless `options.remoteAddress` names one, so a case about a
   * per-address limit or protection must name its address: otherwise every request is a new client
   * and the case passes even when the protection is broken.
   */
  readonly fetch: (request: Request, options?: HostFetchOptions) => Promise<Response>;
  readonly codec: TransportCodec;
  /** The tenants of the backend, by name. */
  readonly tenants: Readonly<Record<string, { readonly id: string; readonly domain: string }>>;
  /** The origins the backend's REST `cors` setting allows. */
  readonly cors: readonly string[];
  /** The configuration the target's backend was started with, by module id. */
  readonly backendConfig: Readonly<Record<string, unknown>>;
  /** A `fetch` over the operator socket (the client's `unixSocketFetch`). */
  readonly operatorFetch: (request: Request) => Promise<Response>;
  /** Whether the deployment runs the live module (its stream endpoint answers); the subscription scenarios run only then. */
  readonly live?: boolean;
}
