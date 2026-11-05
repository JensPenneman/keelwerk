import type { MountHandle } from '../transport/mount-handle.ts';
import type { TransportHost } from '../transport/transport-host.ts';
import type { HostInstance } from './host-entry.ts';

/** What `listen` leaves: the host (with its lifecycle when the runtime built it) and the transports' mounts. */
export interface Listening {
  readonly host: TransportHost | undefined;
  /** Present when the runtime built the host from its entry: `stop` stops it. */
  readonly instance: HostInstance | undefined;
  readonly mounts: readonly MountHandle[];
}
