import type { Position, UsageCharge } from '@keelwerk/core';
import { readiedQueues } from '../job-wake/readied-queues.ts';
import type { CommitTailLane } from './postgres/commit-tail-lane.ts';
import type { SqlPendingEvent } from './sql-pending-event.ts';
import type { SqlQueueCap } from './sql-queue-cap.ts';
import { sqlStreamKey } from './sql-stream-key.ts';

/** How much of a buffer a savepoint began with. */
interface SqlCommitMark {
  readonly events: number;
  readonly lanes: number;
  readonly caps: number;
  readonly readied: number;
  readonly usage: number;
  readonly work: number;
}

/**
 * What a unit owes its commit tail (15.1.4): the events appended so far, the changes of the lanes'
 * `enqueued` counters, the queued caps of the queues it inserted capped jobs into, the usage charges and, once the tail has run, the positions it assigned. The
 * events, the lane changes and the usage charges are shared by the unit and its savepoints; a
 * savepoint that fails takes back what it added (`restore`), exactly as the database takes back its
 * rows. It also records the queues in which the unit made a job takeable, which the adapter reads
 * after the commit (`JobStore.readied`).
 */
export interface SqlCommitBuffer {
  /** Appended events in order; read only, `push` and `restore` change it. */
  readonly events: readonly SqlPendingEvent[];
  /** Lane counter changes in order, not yet summed. */
  readonly lanes: readonly CommitTailLane[];
  /** The queued caps of the queues a capped job was inserted into, in order, not yet reduced. */
  readonly caps: readonly SqlQueueCap[];
  /** Usage charges in order, not yet summed. */
  readonly usage: readonly UsageCharge[];
  /** The positions the tail assigned. */
  readonly assigned: Position[];
  /** The version a stream has with the buffered events, if any are buffered. */
  versionOf(type: string, id: string): number | undefined;
  push(event: SqlPendingEvent): void;
  /** Work to run at the end of the unit, before the commit tail, so the tail stays the last step. */
  defer(work: () => Promise<void>): void;
  /** The deferred work in order, emptying the list. */
  takeWork(): readonly (() => Promise<void>)[];
  /** Buffers usage charges for the tail. */
  charge(charges: readonly UsageCharge[]): void;
  /** A lane's `enqueued` counter changes by `delta` at the tail. */
  moveLane(laneId: string, delta: number): void;
  /** The tail checks that the unit leaves at most `cap` jobs waiting to run in `queue`. */
  capQueue(queue: string, cap: number): void;
  /** A job of `queue` became takeable, or a lane slot of `queue` came back. */
  ready(queue: string): void;
  /** The unit's commit is refused: it made nothing takeable. */
  forgetReadied(): void;
  /** Something became takeable in queues the unit cannot name (a group's slot). */
  readyAnywhere(): void;
  /** The queues recorded so far, or `undefined` when one entry names none. */
  readied(): readonly string[] | undefined;
  mark(): SqlCommitMark;
  restore(mark: SqlCommitMark): void;
}

/**
 * An empty buffer for one unit. `guard` throws once the unit may no longer hand anything to its
 * commit tail: `push`, `defer`, `moveLane`, `capQueue` and `restore` call it first, so a savepoint abandoned by its unit cannot take back what the commit tail is about to write.
 */
export function sqlCommitBuffer(guard: () => void = () => undefined): SqlCommitBuffer {
  const events: SqlPendingEvent[] = [];
  const lanes: CommitTailLane[] = [];
  const caps: SqlQueueCap[] = [];
  const usage: UsageCharge[] = [];
  const work: (() => Promise<void>)[] = [];
  const versions = new Map<string, number>();
  const readied = readiedQueues();
  return {
    events,
    lanes,
    caps,
    usage,
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
    charge: (charges) => {
      guard();
      usage.push(...charges);
    },
    moveLane: (laneId, delta) => {
      guard();
      lanes.push({ laneId, delta });
    },
    capQueue: (queue, cap) => {
      guard();
      caps.push({ queue, cap });
    },
    ready: (queue) => {
      guard();
      readied.ready(queue);
    },
    readyAnywhere: () => {
      guard();
      readied.readyAnywhere();
    },
    forgetReadied: () => {
      readied.restore(0);
    },
    readied: () => readied.queues(),
    mark: () => ({
      events: events.length,
      lanes: lanes.length,
      caps: caps.length,
      readied: readied.mark(),
      usage: usage.length,
      work: work.length,
    }),
    restore: (mark) => {
      guard();
      if (events.length > mark.events) {
        events.length = mark.events;
        versions.clear();
        for (const event of events) versions.set(sqlStreamKey(event.stream), event.version);
      }
      lanes.length = mark.lanes;
      caps.length = mark.caps;
      readied.restore(mark.readied);
      usage.length = mark.usage;
      work.length = mark.work;
    },
  };
}
