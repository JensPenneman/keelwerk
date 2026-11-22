import type { QuotaView } from './quota-view.ts';

/**
 * What a runtime's code asks for the limits: the process's one quota cache. A path that hands
 * limits to an enqueue or checks one calls `fresh()` before the unit it works in and reads the
 * view it answers. The one other way to read a limit is the kernel queue's view of the cache, which
 * is live and asks nothing: the reaction dispatcher asks the cache before each batch.
 */
export interface QuotaLimits {
  /**
   * Starts following the control feed, loads the rows when they were never loaded or have aged
   * out, and answers the view of the rows as they are then. Never rejects, waits at most
   * `targetingReadTimeoutMs`; a load that fails keeps the last rows in the view.
   */
  fresh(): Promise<QuotaView>;
}
