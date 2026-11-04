import type { IncomingMessage } from 'node:http';
import type { RequestState } from './request-state.ts';

/** What the dispatcher passes to the router beside the request. */
export interface HostBindings {
  readonly incoming?: IncomingMessage;
  /** Set on requests that arrive on the operator socket. */
  readonly operatorSocket?: string;
  readonly state: RequestState;
}
