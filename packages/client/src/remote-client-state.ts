import type { RemoteConnection } from './remote-connection.ts';
import type { SurfaceCache } from './surface-cache.ts';

/** What one remote client (and the clients `as` derives from it) works with. */
export interface RemoteClientState extends RemoteConnection {
  readonly surfaces: SurfaceCache;
}
