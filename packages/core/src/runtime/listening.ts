import type { MountHandle } from '../transport/mount-handle.ts';
import type { TransportHost } from '../transport/transport-host.ts';
import type { HostInstance } from './host-entry.ts';

/** What `listen` leaves: the host (with its lifecycle when the runtime built it) and the transports' mounts. */
export interface Listening {
  readonly host: TransportHost | undefined;
  /** Present when the runtime built the host from its entry: `stop` stops it. */
  readonly instance: HostInstance | undefined;
  readonly mounts: readonly MountHandle[];
  /** The TCP port the host the runtime built bound. */
  readonly port?: number;
  /** The operator socket path the host the runtime built bound, after the short-path fallback. */
  readonly operatorSocket?: string;
}
