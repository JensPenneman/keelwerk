import type { Clock } from '@keelwerk/core';
import type { TransportTarget } from './transport-target.ts';

/** One deployment of an ending case: its target (with `advance`, `revoke`, `live: true`), its pinned clock and its stop. */
export interface StreamEndingRun {
  readonly target: TransportTarget;
  readonly clock: Clock;
  /** Stops the deployment; the case calls it exactly once. */
  stop(): Promise<void>;
}
