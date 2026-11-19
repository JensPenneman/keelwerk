import type { Position } from '../storage/position.ts';
import type { PurgeBatch } from '../storage/purge-batch.ts';
import type { EventMatch } from './event-match.ts';
import type { EventSelector } from './event-selector.ts';
import type { StoredEvent } from './stored-event.ts';
import type { StreamAppend } from './stream-append.ts';
import type { StreamRef } from './stream-ref.ts';

/**
 * The event store of a unit (section 15.1.11). M1 carries the members it implements (S-03);
 * `compact`, `purgeStream` and `redact` arrive later.
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
  /**
   * Kernel maintenance in the scope's unit (15.1.11): deletes committed transient records of the
   * unit's scope recorded before `before`, oldest first, at most `limit`, only of the listed stream
   * types, never a stream's newest record and never a record that carries a hash or a previous hash;
   * answers how many it deleted and whether a candidate of a listed type is left (`PurgeBatch`). An
   * empty list removes nothing and answers `{ removed: 0, more: false }`. The one exception to the
   * newest record: that of a receipt stream whose receipt row is gone from the scope, because the
   * stream serves no one then (its version starts again at 1 if a command id returns). `internal`
   * in a read-only or namespace-scope unit; `validation` (core.malformed_request) for a limit
   * outside 1..100000 and for a list that names a type outside `transientPurgeTypes`: the
   * PostgreSQL function holds that list as a literal and refuses any other with 42501.
   */
  purgeTransient(
    before: Temporal.Instant,
    limit: number,
    streamTypes: readonly string[],
  ): Promise<PurgeBatch>;
}
