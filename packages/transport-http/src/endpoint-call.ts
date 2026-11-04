import type { Carrier, InvocationSession } from '@keelwerk/core';
import type { HostContext } from './host-context.ts';
import type { RequestState } from './request-state.ts';

/** Everything an endpoint of the invocation protocol needs about one request. */
export interface EndpointCall {
  readonly host: HostContext;
  readonly state: RequestState;
  readonly session: InvocationSession;
  readonly carrier: Carrier;
  readonly request: Request;
  /** The body, already read within the limit; empty for requests without one. */
  readonly bytes: Uint8Array<ArrayBuffer>;
}
