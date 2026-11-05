import type { ProducerResult } from '../producers/producer-result.ts';
import type { SyncResult } from './sync-result.ts';

/** What the probe child reports (section 13.6): the producers' result and the synchronisation. */
export interface ProbeResult {
  readonly producers: ProducerResult;
  /** Undefined when a producer failed: the database is left alone while the sources are broken. */
  readonly sync: SyncResult | undefined;
}
