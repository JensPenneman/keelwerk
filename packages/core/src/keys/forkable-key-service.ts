import type { KeyService } from '../kernel/key-service.ts';

/** A key service that can hand out a copy whose new scope keys stay in memory (the dry run). */
export interface ForkableKeyService extends KeyService {
  /** A key service over the same keys that never commits a key it creates. */
  fork(): KeyService;
}
