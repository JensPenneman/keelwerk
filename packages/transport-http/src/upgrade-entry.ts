import type { EndpointCall } from './endpoint-call.ts';
import type { PendingUpgrade } from './pending-upgrade.ts';
import type { UpgradeRegistration } from './upgrade-registration.ts';

/** One WebSocket subprotocol the host serves. */
export interface UpgradeEntry {
  readonly protocol: string;
  /** The host's own endpoint; absent: the entry serves the paths transports register for the protocol. */
  readonly path?: string;
  /** After the session, the origin and the ticket checks: a refusal, or null once the socket was accepted. */
  serve(
    call: EndpointCall,
    upgrade: PendingUpgrade,
    registered?: UpgradeRegistration,
  ): Promise<Response | null>;
}
