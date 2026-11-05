import type { AnchorSinkStatus } from './anchor-sink-status.ts';

/** Appends each scope's chain head to the ledger sinks (section 15.1.8). */
export interface AnchorWriter {
  /** A notifier batch: the scopes it names whose head moved since their last anchor and whose cadence has passed get an anchor; the others wait for the next batch or `flush`. */
  onBatch(scopeIds: readonly string[]): Promise<void>;
  /** Anchors these scopes at once, whatever their cadence: the catch-up after a start or before a stop. */
  anchorNow(scopeIds: readonly string[]): Promise<void>;
  /** Anchors every scope still waiting, whatever its cadence: called when the process stops. */
  flush(): Promise<void>;
  /** The position each scope was last anchored at by this writer. */
  anchoredPositions(): ReadonlyMap<string, bigint>;
  /** Per sink: the appends it refused and the last failure; readable by the control reader. */
  sinkStatus?(): readonly AnchorSinkStatus[];
}
