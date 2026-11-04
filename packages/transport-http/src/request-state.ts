import type { Carrier, InvocationSession } from '@keelwerk/core';

/** The facts of one request that the response decoration reads; created per request, never shared. */
export interface RequestState {
  readonly requestId: string;
  readonly traceparent?: string;
  /** The `Keelwerk-Version` the client sent, echoed when no session exists. */
  readonly requestedVersion?: string;
  carrier?: Carrier;
  session?: InvocationSession;
  /** The route template for spans and metrics. */
  route: string;
  transport: string;
  /** The origin that passed the CORS check, echoed in the response. */
  corsOrigin?: string;
  readonly setCookies: string[];
  /** The action of a single invocation, for the span. */
  action?: string;
  /** The deprecation of the action of a single invocation. */
  deprecatedAction?: { readonly at: string; readonly sunset?: string };
  /** The id of a command whose id the host generated. */
  generatedCommandId?: string;
  /** The error kind and code of the response, for the error counter. */
  failure?: { readonly kind: string; readonly code: string };
}
