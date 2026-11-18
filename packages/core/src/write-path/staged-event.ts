import type { Hlc } from '../events/hlc.ts';
import type { EntityEntry } from '../registry/entity-entry.ts';
import type { WrittenRow } from './written-row.ts';

/** An event evolved and sealed, waiting for the meta and its place in the chain. */
export interface StagedEvent {
  /** `entity/id` of the stream. */
  readonly key: string;
  readonly work: WrittenRow;
  /** The place of the row image this event produced in `work.images`. */
  readonly imageAt: number;
  readonly entry: EntityEntry;
  readonly draftId: string;
  readonly eventId: string;
  readonly name: string;
  readonly hlc: Hlc;
  readonly recordedAt: Temporal.Instant;
  readonly data: unknown;
  readonly before: unknown | null;
  readonly transient: boolean;
  readonly version: number;
}
