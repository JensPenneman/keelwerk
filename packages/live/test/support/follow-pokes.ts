import type { InvocationSession, LiveFrame } from '@keelwerk/core';
import type { TestPrincipal } from '@keelwerk/testing';
import { defineLive } from '../../src/define-live.ts';
import type { Live } from '../../src/live-module.ts';
import type { PokesJoinObserver } from '../../src/pokes/create-pokes-source.ts';
import type { CollectedFrames } from './collect-frames.ts';
import { collectFrames } from './collect-frames.ts';

/** What the join of a pokes subscription decided. */
type PokesJoin = Parameters<PokesJoinObserver>[1];

const keyOf = (who: PokesFollower): string => `${who.tenantId}/${who.principalId}`;

const sessionKeyOf = (session: InvocationSession): string =>
  session.scope.level === 'tenant'
    ? `${session.scope.tenantId}/${session.principal.ref?.principalId}`
    : '';

/**
 * A followed pokes stream whose reader has joined, or that ended first: what the join decided is
 * `join`. Its `until` has no time limit of its own: it returns when the frames match and throws
 * when the stream ends first, and the test's timeout guards a hang.
 */
export interface JoinedPokes<T = unknown> extends Omit<CollectedFrames<T>, 'until'> {
  /**
   * What the reader decided at the join, before anything was written after it: `silent` (nothing
   * was sent for the gap between the token and the head: every later write is poked of its own),
   * `poked` (one poke at the head was sent for the gap) or `ended` (the stream ended before or at
   * the join: a token refused at the set-up, a `reset`, a failure or the hub closing).
   */
  readonly join: PokesJoin;
  until(test: (frames: readonly LiveFrame<T>[]) => boolean): Promise<void>;
}

/** Who a pokes stream is followed for: the tenant and the principal id of its session. */
export interface PokesFollower {
  readonly tenantId: string;
  readonly principalId: string;
}

/**
 * The joins of the pokes subscriptions of one runtime: `live` is the module the runtime is started
 * with.
 */
export interface JoinWatch {
  /**
   * The live module whose hub tells this watch about every join: the runtime is started with it.
   */
  readonly live: Live;
  /**
   * Follows a pokes stream and answers when its reader has joined (or the stream ended first). It
   * throws when no runtime has opened a hub from `live`: such a stream is never told of a join.
   */
  followPokes<T = unknown>(
    who: PokesFollower,
    subscribe: () => AsyncIterable<LiveFrame<T>>,
  ): Promise<JoinedPokes<T>>;
}

/** The follower of a test principal in a tenant. */
export const followerOf = (tenant: { readonly id: string }, who: TestPrincipal): PokesFollower => ({
  tenantId: tenant.id,
  principalId: who.principalId ?? who.subject ?? '',
});

/**
 * The way a test follows a pokes stream and then writes: `followPokes` answers only after the
 * reader has joined, so a write made after the answer is a write after the join, whatever the
 * set-up of the subscription costs. A pokes stream sends no head, so nothing else says it. The join
 * of the subscription is matched to the follower by tenant and principal id; two streams of one
 * follower cannot be followed at the same time, so that the match is one to one. No wait here has a
 * time limit: the join comes, or the stream ends, and the test's own timeout guards a hang.
 */
export function joinWatch(): JoinWatch {
  const waiting = new Map<string, (join: PokesJoin) => void>();
  let hubs = 0;
  const observe: PokesJoinObserver = (session, join) => {
    const key = sessionKeyOf(session);
    waiting.get(key)?.(join);
    waiting.delete(key);
  };
  return {
    live: defineLive(observe, () => {
      hubs += 1;
    }),
    followPokes: async <T>(who: PokesFollower, subscribe: () => AsyncIterable<LiveFrame<T>>) => {
      if (hubs === 0) {
        throw new Error("no runtime has opened a hub from this watch's live module");
      }
      const key = keyOf(who);
      if (waiting.has(key)) {
        throw new Error(`a pokes stream of ${key} is followed already and has not joined yet`);
      }
      const joined = new Promise<PokesJoin>((resolve) => waiting.set(key, resolve));
      const stream = collectFrames<T>(subscribe());
      const timed = stream.until;
      const join = await Promise.race([joined, stream.whenEnded().then((): PokesJoin => 'ended')]);
      waiting.delete(key);
      return Object.assign(stream, {
        join,
        until: (test: (frames: readonly LiveFrame<T>[]) => boolean) =>
          timed(test, Number.POSITIVE_INFINITY),
      });
    },
  };
}
