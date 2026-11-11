import type { LiveHub } from './live-hub.ts';

/** A hub a runtime opened for one app. */
export interface RuntimeLiveHub extends LiveHub {
  /**
   * Ends every subscription of the hub without a frame or an error and stops its readers and timers.
   * Resolves when what was in flight has settled, or when `deadline` aborts. It can be called more
   * than once and never rejects.
   */
  close(deadline: AbortSignal): Promise<void>;
}
