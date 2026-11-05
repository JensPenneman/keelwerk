import type { KeyService } from '../kernel/key-service.ts';
import type { ScopeKeyStore } from '../storage/scope-key-store.ts';

/** A key service that can hand out a copy whose new scope keys stay in memory (the dry run). */
export interface ForkableKeyService extends KeyService {
  /** A key service over the same keys that never commits a key it creates. */
  fork(): KeyService;
  /**
   * A key service that reads and creates scope keys through `store`, the store of a
   * deployment-scope unit that is already open, so a single-unit adapter never waits for a second
   * unit. It reads the shared cache but never writes it, and shares no pending creation: what the
   * unit holds commits or rolls back with it.
   */
  within(store: ScopeKeyStore): KeyService;
}
