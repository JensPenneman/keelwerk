import type { IncomingMessage } from 'node:http';
import type { PendingUpgrade } from './pending-upgrade.ts';
import type { RequestState } from './request-state.ts';

/** What the dispatcher passes to the router beside the request. */
export interface HostBindings {
  readonly incoming?: IncomingMessage;
  /** Set on requests that arrive on the operator socket. */
  readonly operatorSocket?: string;
  /** Set on a WebSocket upgrade: the handshake the host may accept. */
  readonly upgrade?: PendingUpgrade;
  readonly state: RequestState;
}
