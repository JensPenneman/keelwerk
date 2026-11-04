import type { SurfaceAction } from './surface-action.ts';
import type { SurfaceEntity } from './surface-entity.ts';
import type { SurfaceError } from './surface-error.ts';
import type { SurfaceEvent } from './surface-event.ts';
import type { SurfaceModule } from './surface-module.ts';
import type { SurfaceResolver } from './surface-resolver.ts';

/** One app's public interface at one API version: derived during `compose`, serialisable, deterministic, order-independent (section 16.2.2). */
export interface ApiSurface {
  readonly format: 'keelwerk.surface/1';
  /** The app id. */
  readonly app: string;
  /** The dated API version this surface describes (section 18.2). */
  readonly apiVersion: string;
  /** 'sha256-' + base64url of SHA-256 over the RFC 8785 form, without `hash`. */
  readonly hash: string;
  /** Sorted by id. */
  readonly modules: readonly SurfaceModule[];
  /** Sorted by ref. */
  readonly entities: readonly SurfaceEntity[];
  /** Sorted by ref. */
  readonly actions: readonly SurfaceAction[];
  /** Sorted by code; includes the core codes. */
  readonly errors: readonly SurfaceError[];
  /** Sorted by entity ref, then name. */
  readonly events: readonly SurfaceEvent[];
  /** The selected principal resolvers sorted by id, from their `describe()` (F-09 change note of WP-33); derivation always sets it. */
  readonly resolvers?: readonly SurfaceResolver[];
}
