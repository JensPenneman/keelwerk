import type { NewEvent, StreamRef } from '@keelwerk/core';

/** An event in the unit's buffer, before the commit tail gives it a position (15.1.4). */
export interface SqlPendingEvent {
  readonly stream: StreamRef;
  /** The 1-based version in its stream. */
  readonly version: number;
  readonly partition: string | null;
  readonly event: NewEvent;
}
