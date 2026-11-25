import type { Clock } from '@keelwerk/core';
import type { LoggedLine } from '../../harness/logged-line.ts';
import type { TransportTarget } from './transport-target.ts';

/** One deployment of an ending case: its target (with `advance`, `revoke`, `live: true`), its pinned clock and its stop. */
export interface StreamEndingRun {
  readonly target: TransportTarget;
  readonly clock: Clock;
  /** The lines the deployment's logger recorded (`recordingLogger`): the host says there why it ended a mounted stream. */
  readonly lines: readonly LoggedLine[];
  /** Whether the host serves the stream itself (the protocol's and REST's): it then writes the `end` frame of a limit. */
  readonly hostServes: boolean;
  /** Stops the deployment; the case calls it exactly once. */
  stop(): Promise<void>;
}
