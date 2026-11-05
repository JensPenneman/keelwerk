import type { Position } from '../storage/position.ts';
import type { EventMatch } from './event-match.ts';
import type { EventSelector } from './event-selector.ts';
import type { StoredEvent } from './stored-event.ts';
import type { StreamAppend } from './stream-append.ts';
import type { StreamRef } from './stream-ref.ts';

/**
 * The event store of a unit (section 15.1.11). M1 carries the members it implements (S-03);
 * `compact`, `purgeStream`, `purgeTransient` and `redact` arrive in M2 with their users.
 */
export interface EventStore {
  /** Buffers appends to one or more streams; they are written atomically at the commit tail. `conflict` on a version mismatch. */
  append(
    batch: readonly StreamAppend[],
  ): Promise<readonly { readonly eventId: string; readonly version: number }[]>;
  /** One stream in version order, as stored (encrypted, not upcast); includes events buffered in this unit. */
  readStream(
    stream: StreamRef,
    range?: {
      readonly fromVersion?: number;
      readonly toVersion?: number;
      readonly limit?: number;
    },
  ): Promise<readonly StoredEvent[]>;
  /** Events of the unit's scope after a position, in position order, filtered by the selector. */
  readAll(
    after: Position | null,
    options: {
      readonly limit: number;
      readonly selector?: EventSelector;
      readonly includeTransient?: boolean;
    },
  ): Promise<{ readonly events: readonly StoredEvent[]; readonly next: Position | null }>;
  /** The highest committed position of the unit's scope for the selector: the basis of tokens. */
  head(selector?: EventSelector): Promise<Position | null>;
  /** The committed events of the unit's scope that the id names after a position, in position order, transient records included; at most `limit` a page. `next` is the position to pass as `after` for the following page, `null` when this page was the last. Reaches a command's events without reading the chain. */
  find(
    match: EventMatch,
    page: { readonly after: Position | null; readonly limit: number },
  ): Promise<{ readonly events: readonly StoredEvent[]; readonly next: Position | null }>;
  /** Positions this unit assigned, available after commit. */
  committed(): readonly Position[];
  /** The scopes of this namespace whose head moved after the given marks (wake-up recovery and kernel fan-out). */
  movedScopes(
    since: ReadonlyMap<string, Position>,
    limit: number,
  ): Promise<readonly { readonly scopeId: string; readonly head: Position }[]>;
}
