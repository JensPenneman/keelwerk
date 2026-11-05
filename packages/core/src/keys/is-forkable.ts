import type { KeyService } from '../kernel/key-service.ts';
import type { ForkableKeyService } from './forkable-key-service.ts';

/** Whether a key service can fork. */
export function isForkable(keys: KeyService): keys is ForkableKeyService {
  return typeof (keys as { readonly fork?: unknown }).fork === 'function';
}
