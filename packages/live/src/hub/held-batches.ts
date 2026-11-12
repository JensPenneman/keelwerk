import type { InvocationSession } from '@keelwerk/core';
import type { ReaderBatch } from './reader-batch.ts';

/** What a stream's held batches are applied with. */
export interface HeldBatchesInput {
  /** The session the stream runs under now (a renewal replaces it). */
  readonly session: () => InvocationSession;
  /** Revalidates the stream's session (16.3.4): resolves once it is renewed or the stream is ended. */
  readonly revalidate: () => Promise<void>;
  /** Applies one batch, in order. */
  readonly apply: (batch: ReaderBatch) => void;
  /** Whether the stream is live: batches are applied only then, and are held before. */
  readonly isLive: () => boolean;
  readonly ended: () => boolean;
  /** Called when more batches are held than the limit allows. */
  readonly overflow: () => void;
  readonly maxHeldBatches: number;
}

/** The batches a reader delivered to one stream, applied in order. */
export interface HeldBatches {
  /** Holds a delivered batch and applies what can be applied. */
  readonly deliver: (batch: ReaderBatch) => void;
  /** Applies the held batches in order; a batch that touches a dependency waits for a revalidation first. */
  readonly flush: () => void;
  /** Whether the batch holds an event on a row that the session depends on. */
  readonly touchesDependency: (batch: ReaderBatch) => boolean;
  /** Whether nothing is held and no revalidation is in flight: the stream's record is what the next batch will meet. */
  readonly idle: () => boolean;
  /** Drops what is held. */
  readonly clear: () => void;
  /** The entity types the reader must also follow for the stream: those of the session's dependencies. */
  readonly extraStreamTypes: () => string[];
}

/**
 * The held batches of a stream (15.4.5): a batch with an event on a row the session depends on (the
 * pass or session that authenticated it, S-151) is held, the session is revalidated, and the held
 * batches are applied in order once it is renewed; when it is not, the stream has ended and
 * nothing held is sent (D1).
 */
export function createHeldBatches(input: HeldBatchesInput): HeldBatches {
  let held: ReaderBatch[] = [];
  /** True while a revalidation is in flight: batches are held until it is done. */
  let revalidating = false;
  /** Batches whose dependency events a revalidation has cleared. */
  const cleared = new WeakSet<ReaderBatch>();

  /** Whether the batch holds an event on a row that the session depends on. */
  const touchesDependency = (batch: ReaderBatch): boolean => {
    const deps = input.session().dependsOn;
    if (deps === undefined || deps.length === 0) return false;
    return batch.events.some((event) =>
      deps.some((dep) => dep.entity === event.stream.type && dep.id === event.stream.id),
    );
  };

  const flush = (): void => {
    while (input.isLive() && !revalidating && held.length > 0) {
      const batch = held[0];
      if (batch === undefined) return;
      if (!cleared.has(batch) && touchesDependency(batch)) {
        revalidating = true;
        void input.revalidate().then(() => {
          revalidating = false;
          if (input.ended()) return;
          cleared.add(batch);
          flush();
        });
        return;
      }
      held.shift();
      input.apply(batch);
      if (input.ended()) return;
    }
  };

  return {
    deliver: (batch) => {
      if (input.ended()) return;
      if (held.length >= input.maxHeldBatches) input.overflow();
      else {
        held.push(batch);
        flush();
      }
    },
    flush,
    touchesDependency,
    idle: () => held.length === 0 && !revalidating,
    clear: () => {
      held = [];
    },
    extraStreamTypes: () => [
      ...new Set((input.session().dependsOn ?? []).map((dep) => dep.entity)),
    ],
  };
}
