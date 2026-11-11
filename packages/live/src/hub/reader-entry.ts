import type { LiveKernel } from '@keelwerk/core';
import type { ReaderListener } from './reader-listener.ts';

/** One listener of a scope reader. */
export interface ReaderEntry {
  readonly listener: ReaderListener;
  readonly kernel: LiveKernel;
  /** The key of the listener's plan group; absent for a listener without a view. */
  readonly group: string | undefined;
  joined: boolean;
  active: boolean;
}
