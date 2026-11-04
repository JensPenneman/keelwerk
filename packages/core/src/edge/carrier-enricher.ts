import type { Carrier } from '../invoker/carrier.ts';
import type { ScopeKey } from './scope-directory.ts';

/** Pure: sets `carrier.scopeKey` before scope resolution, for example from a receiver path (section 16.5.8). */
export interface CarrierEnricher {
  readonly id: string;
  /** The scope key the carrier names, or null when this enricher does not apply. */
  enrich(carrier: Carrier): ScopeKey | null;
}
