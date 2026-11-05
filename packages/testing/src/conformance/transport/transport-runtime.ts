import type { Runtime } from '@keelwerk/core';

/** A running deployment of the transport fixture app with its HTTP host listening in process. */
export interface TransportRuntime {
  readonly runtime: Runtime;
  /** The host's dispatch (`runtime.host.fetch`), the one entry point the suite sends requests through. */
  fetch(request: Request): Promise<Response>;
  readonly backendId: string;
  /** The configuration the backend was created with, by module id. */
  readonly backendConfig: Readonly<Record<string, unknown>>;
  /** Tenant name to id. */
  readonly tenants: Readonly<Record<string, string>>;
  /** The domain registered for each tenant. */
  readonly domains: Readonly<Record<string, string>>;
  /** The operator socket path the host listens on. */
  readonly socket: string;
  stop(): Promise<void>;
}
