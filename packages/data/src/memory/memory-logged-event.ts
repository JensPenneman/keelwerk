import type { StoredEvent } from '@keelwerk/core';

/** An event in the log, with its local name for selectors. */
export interface MemoryLoggedEvent {
  readonly name: string;
  readonly event: StoredEvent;
}
