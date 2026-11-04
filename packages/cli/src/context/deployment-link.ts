import type { CapabilitiesDocument, InvokeRequest, InvokeResponse } from '@keelwerk/core';
import type { SurfaceLookup } from './surface-lookup.ts';

/** What one request may carry besides its body. */
export interface LinkOptions {
  readonly signal?: AbortSignal;
  /** Sent as `traceparent`. */
  readonly traceparent?: string;
  /** Sent as `Keelwerk-Version` on `/invoke`: the API version of the surface the flags came from. */
  readonly apiVersion?: string;
}

/**
 * The transport to one deployment (the invocation protocol of section 16.8.2). A network failure
 * rejects with `cli.unreachable`, an interrupt with `interrupted`; every answer the server gives, errors included, resolves as an `InvokeResponse`.
 */
export interface DeploymentLink {
  invoke(request: InvokeRequest, options?: LinkOptions): Promise<InvokeResponse>;
  /** `GET /surface`, revalidated with `If-None-Match` when `hash` is given. */
  surface(hash?: string, options?: LinkOptions): Promise<SurfaceLookup>;
  capabilities(options?: LinkOptions): Promise<CapabilitiesDocument>;
}
