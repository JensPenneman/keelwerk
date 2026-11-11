import type { Position } from '@keelwerk/core';
import type { CommitTailLane } from './postgres/commit-tail-lane.ts';
import type { SqlPendingEvent } from './sql-pending-event.ts';
import { sqlStreamKey } from './sql-stream-key.ts';

/** How much of a buffer a savepoint began with. */
interface SqlCommitMark {
  readonly events: number;
  readonly lanes: number;
  readonly work: number;
}

/**
 * What a unit owes its commit tail (15.1.4): the events appended so far, the changes of the lanes'
 * `enqueued` counters and, once the tail has run, the positions it assigned. The events and the
 * lane changes are shared by the unit and its savepoints; a savepoint that fails takes back what it
 * added (`restore`), exactly as the database takes back its rows.
 */
export interface SqlCommitBuffer {
  /** Appended events in order; read only, `push` and `restore` change it. */
  readonly events: readonly SqlPendingEvent[];
  /** Lane counter changes in order, not yet summed. */
  readonly lanes: readonly CommitTailLane[];
  /** The positions the tail assigned. */
  readonly assigned: Position[];
  /** The version a stream has with the buffered events, if any are buffered. */
  versionOf(type: string, id: string): number | undefined;
  push(event: SqlPendingEvent): void;
  /** Work to run at the end of the unit, before the commit tail, so the tail stays the last step. */
  defer(work: () => Promise<void>): void;
  /** The deferred work in order, emptying the list. */
  takeWork(): readonly (() => Promise<void>)[];
  /** A lane's `enqueued` counter changes by `delta` at the tail. */
  moveLane(laneId: string, delta: number): void;
  mark(): SqlCommitMark;
  restore(mark: SqlCommitMark): void;
}

/**
 * An empty buffer for one unit. `guard` throws once the unit may no longer hand anything to its
 * commit tail: `push`, `defer`, `moveLane` and `restore` call it first, so a savepoint abandoned by its unit cannot take back what the commit tail is about to write.
 */
export function sqlCommitBuffer(guard: () => void = () => undefined): SqlCommitBuffer {
  const events: SqlPendingEvent[] = [];
  const lanes: CommitTailLane[] = [];
  const work: (() => Promise<void>)[] = [];
  const versions = new Map<string, number>();
  return {
    events,
    lanes,
    assigned: [],
    versionOf: (type, id) => versions.get(sqlStreamKey({ type, id })),
    push: (event) => {
      guard();
      events.push(event);
      versions.set(sqlStreamKey(event.stream), event.version);
    },
    takeWork: () => work.splice(0),
    defer: (fn) => {
      guard();
      work.push(fn);
    },
    moveLane: (laneId, delta) => {
      guard();
      lanes.push({ laneId, delta });
    },
    mark: () => ({ events: events.length, lanes: lanes.length, work: work.length }),
    restore: (mark) => {
      guard();
      if (events.length > mark.events) {
        events.length = mark.events;
        versions.clear();
        for (const event of events) versions.set(sqlStreamKey(event.stream), event.version);
      }
      lanes.length = mark.lanes;
      work.length = mark.work;
    },
  };
}
