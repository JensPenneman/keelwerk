import type { NewEvent, StreamRef } from '@keelwerk/core';

/** An event in the unit's buffer, before the commit tail gives it a position. */
export interface MemoryPendingEvent {
  readonly stream: StreamRef;
  readonly version: number;
  readonly partition: string | null;
  readonly event: NewEvent;
}
