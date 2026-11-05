import type { NewEvent } from '../events/new-event.ts';
import type { EntityEntry } from '../registry/entity-entry.ts';
import type { StorageRow } from '../storage/storage-row.ts';

/** One row a command wrote: its first and last image and the events that took it from one to the other. */
export interface WrittenRow {
  readonly entry: EntityEntry;
  readonly id: string;
  readonly created: boolean;
  /** The row as the command loaded it; absent for a created row. */
  readonly loaded: StorageRow | undefined;
  /** The stream version the command loaded: the expected version of the append (0 creates). */
  readonly loadedVersion: number;
  /** The row after its last event. */
  row: StorageRow;
  readonly events: NewEvent[];
  /** The payload of each event before its personal values were sealed, in step with `events`: what an inline reaction reads. */
  readonly opened: { readonly data: unknown; readonly before: unknown | null }[];
  /** The row right after each event, in step with `events` (what an inline reaction sees). */
  readonly images: StorageRow[];
}
