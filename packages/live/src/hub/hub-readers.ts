import type { ScopeReaders } from './scope-readers.ts';

/** The readers of one hub as the hub sees them: sources get only `ScopeReaders`. */
export interface HubReaders extends ScopeReaders {
  /**
   * Closes the readers: later attaches are refused `unavailable`, every listener still attached is
   * ended through `end()`, every timer and wake-up loop stops and every pass in flight is aborted.
   * Resolves when every pass, every follow loop and every unit has settled, or when `deadline` aborts.
   */
  close(deadline: AbortSignal): Promise<void>;
}
