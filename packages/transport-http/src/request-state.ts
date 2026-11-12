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
  /** Set when the request belongs to a REST mount: its errors are problem documents (section 16.5.3) typed under this origin and path. */
  problemBase?: string;
  /** The action of a single invocation, for the span. */
  action?: string;
  /** The deprecation of the action of a single invocation. */
  deprecatedAction?: { readonly at?: string; readonly sunset?: string };
  /** The id of a command whose id the host generated. */
  generatedCommandId?: string;
  /** Set once a WebSocket upgrade was accepted: the response is never sent, the request counts as 101. */
  upgraded?: true;
  /** The error kind and code of the response, for the error counter. */
  failure?: { readonly kind: string; readonly code: string };
}
