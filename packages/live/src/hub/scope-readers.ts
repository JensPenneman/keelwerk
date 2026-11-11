import type { LiveKernel } from '@keelwerk/core';
import type { ReaderListener } from './reader-listener.ts';

/** The readers of one hub: one per scope with local subscribers (15.2.5, 15.4.9). */
export interface ScopeReaders {
  /**
   * Attaches to the reader of `kernel.target` and `kernel.scopeId`, started on the first attach and
   * stopped after the last detach, and triggers a pass. Throws `unavailable` when a limit is reached.
   * The answer detaches; calling it twice is harmless.
   */
  attach(kernel: LiveKernel, listener: ReaderListener): () => void;
}
