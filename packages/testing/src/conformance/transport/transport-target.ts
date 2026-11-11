import type { TransportCodec } from './transport-codec.ts';

/** What the suite runs against: a request function, a codec and the deployment's tenants. */
export interface TransportTarget {
  /** The name shown in the test titles. */
  readonly name: string;
  /** The host's dispatch: `runtime.host.fetch`, or `fetch` against a listening port. */
  readonly fetch: (request: Request) => Promise<Response>;
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
