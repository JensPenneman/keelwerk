import type { ScopeTarget } from '../invoker/scope-target.ts';
import type { Registry } from '../registry/registry.ts';

/** A namespace the fetchers sweep, with the registry of its app (receipts and their change records). */
export interface QueueSource extends Omit<ScopeTarget, 'scope'> {
  readonly registry: Registry;
}
