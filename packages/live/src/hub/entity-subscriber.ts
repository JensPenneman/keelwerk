import type {
  EntityChange,
  InvocationSession,
  LiveFrame,
  LiveKernel,
  LiveView,
  Position,
  StateToken,
  WatchInput,
} from '@keelwerk/core';
import { errors, KeelwerkError, liveKernelOf } from '@keelwerk/core';
import { changesOfBatch } from './changes-of-batch.ts';
import { disclosureReplay } from './disclosure-replay.ts';
import { createHeldBatches } from './held-batches.ts';
import type { HubMember } from './hub-member.ts';
import { limitedRead } from './limited-read.ts';
import type { LiveSubscription } from './live-subscription.ts';
import { readSnapshot } from './read-snapshot.ts';
import type { ReaderBatch } from './reader-batch.ts';
import type { ReaderListener } from './reader-listener.ts';
import type { ResolvedHubLimits } from './resolve-hub-limits.ts';
import type { ScopeReaders } from './scope-readers.ts';
import type { StartLimiter } from './start-limiter.ts';
import { createSubscriptionBuffer } from './subscription-buffer.ts';
import type { VisibilitySet } from './visibility-set.ts';
import { createVisibilitySet } from './visibility-set.ts';

/** Streams judged per replay read (D3, D7). */
const replayChunk = 500;

type Phase = 'new' | 'joining' | 'starting' | 'live' | 'ended';

/** What one subscription of an entity is built from. */
export interface EntitySubscriberInput {
  readonly session: InvocationSession;
  readonly entity: string;
  readonly input: WatchInput<unknown>;
  readonly resume: StateToken | undefined;
  readonly readers: ScopeReaders;
  readonly limits: ResolvedHubLimits;
  /** The units the start reads of all subscriptions of the hub share. */
  readonly startUnits: StartLimiter;
  /**
   * Revalidates the subscription's session now (16.3.4): resolves once it is renewed or the stream is
   * ended (the hub's revalidator never rejects).
   */
  readonly revalidate: (subscription: LiveSubscription) => Promise<void>;
  /** Lists the member with the hub, the moment the subscription starts; answers how to remove it. */
  readonly register: (member: HubMember) => () => void;
}

/**
 * One subscription's state machine (15.4.3 to 15.4.5, D3, D6, D8). Iteration starts it: it builds its
 * view and attaches to the reader of its scope; once the reader's first pass has joined it, it reads
 * its start (the rows of `from: 'beginning'`, or the replay of a resume) in units of its own, sends
 * `head`, then follows the batches the reader delivers. Items go through a bounded buffer; a buffer
 * that overflows is replaced by `reset` `overflow`. Whatever a unit or a reader fails with ends the
 * stream: `next()` throws. The hub closes it through its
 * member: the stream ends without a frame or an error and a pending `next()` is done. The start
 * reads wait for a slot of the hub's start limiter. The batches the reader delivers meanwhile are not
 * held: the subscriber keeps the end of their range and whether one touched a row the session depends
 * on, and before `head` it reads that range from the log as a resume does, revalidating first when the
 * flag is set, until nothing newer has arrived. Whatever phase it is in, it names to the reader the
 * streams of a batch it cannot place (`undecided`), so that the reader reads their earlier image; until
 * it is live, and while a batch is held, its visibility set counts as unknown, because the batch is
 * delivered after the reader's unit has closed and the set may change in between. A stream may thus
 * read earlier images that nothing uses.
 * A batch with an event on a row the session depends on (the pass or session that authenticated it,
 * S-151) is held, the session is revalidated, and the held batches are applied in order once it is
 * renewed; when it is not, the stream has ended and nothing held is sent (D1).
 */
export function createEntitySubscriber(
  input: EntitySubscriberInput,
): AsyncIterable<LiveFrame<EntityChange<unknown>>> {
  const { limits } = input;
  return {
    [Symbol.asyncIterator]: () => {
      const buffer = createSubscriptionBuffer({
        maxItems: limits.maxBufferedItems,
        maxBytes: limits.maxBufferedBytes,
      });
      const set = createVisibilitySet(limits.visibilityBound);
      const abort = new AbortController();
      let session = input.session;
      let kernel: LiveKernel | undefined;
      let view: LiveView | undefined;
      let phase: Phase = 'new';
      let floor: Position = 0n;
      let detach: (() => void) | undefined;
      let unregister: (() => void) | undefined;
      let setup: Promise<void> | undefined;
      let joinAt: ((at: Position) => void) | undefined;
      let failed = false;
      /** The units of the start that have not settled: closing waits for them. */
      const pending = new Set<Promise<void>>();

      const ended = (): boolean => phase === 'ended';
      const end = (): void => {
        if (ended()) return;
        phase = 'ended';
        detach?.();
        unregister?.();
        abort.abort();
        held.clear();
      };
      const fail = (error: KeelwerkError): void => {
        buffer.fail(error);
        end();
      };
      const failWith = (error: unknown): void => {
        if (error instanceof KeelwerkError) {
          fail(error);
          return;
        }
        kernel?.log.warn('a live stream failed', { entity: input.entity });
        fail(errors.unavailable('The live stream is not available now.'));
      };
      const reset = (reason: 'overflow' | 'resync'): void => {
        const state = reason === 'overflow' ? buffer.lastDelivered : undefined;
        buffer.replaceWith({ control: 'reset', reason, ...(state === undefined ? {} : { state }) });
        end();
      };
      const emit = (frame: LiveFrame<EntityChange<unknown>>): boolean => {
        if (ended()) return false;
        if (buffer.push(frame)) return true;
        reset('overflow');
        return false;
      };

      const held = createHeldBatches({
        session: () => session,
        revalidate: () => input.revalidate(subscription),
        apply: (batch) => apply(batch),
        isLive: () => phase === 'live',
        ended,
        overflow: () => reset('overflow'),
        maxHeldBatches: limits.maxHeldBatches,
      });

      /** The end of the batches the reader delivered while the start was read, and whether one touched a row the session depends on. */
      const arrived = { to: 0n as Position, dependency: false };

      const apply = (batch: ReaderBatch): void => {
        if (view === undefined || batch.to <= floor) return;
        const changes = changesOfBatch({ view, batch, set, floor });
        // A removal the set cannot decide and nobody judged (the set filled up while the stream started) is not guessed.
        if (changes.uncertain || changes.unknown.length > 0) {
          reset('resync');
          return;
        }
        for (const item of changes.items) if (!emit(item)) return;
        for (const id of changes.visible) set.add(id);
        for (const id of changes.gone) set.delete(id);
      };

      const snapshot = (current: LiveKernel, now: LiveView): Promise<boolean> =>
        readSnapshot({
          read: limitedRead({ kernel: current, startUnits: input.startUnits, abort, pending }),
          kernel: current,
          view: now,
          buffer,
          set,
          emit,
          ended,
          timeoutMs: limits.passTimeoutMs,
        });

      const resumeFrom = async (
        current: LiveKernel,
        now: LiveView,
        since: Position,
        at: Position,
      ): Promise<boolean> => {
        const steps = disclosureReplay({
          kernel: {
            ...current,
            read: limitedRead({ kernel: current, startUnits: input.startUnits, abort, pending }),
          },
          view: now,
          since,
          head: at,
          chunk: replayChunk,
          limit: limits.visibilityBound,
          timeoutMs: limits.passTimeoutMs,
          signal: abort.signal,
        });
        for await (const step of steps) {
          if (ended()) return false;
          if (step.kind === 'reset') {
            reset('resync');
            return false;
          }
          await buffer.whenBelowHalf();
          if (!emit({ event: step.event })) return false;
          const { event } = step;
          // An archived row told without its row is one the subscriber no longer holds.
          if (event.type === 'removed' || (event.type === 'archived' && !now.includeArchived)) {
            set.delete(event.id);
          } else set.add(event.id);
        }
        return !ended();
      };

      const begin = async (at: Position): Promise<void> => {
        const current = kernel;
        const now = view;
        if (current === undefined || now === undefined) return;
        phase = 'starting';
        floor = at;
        try {
          const token = input.resume ?? now.after;
          if (token !== undefined) {
            const since = now.judge(token, at);
            if (since === 'resync') {
              reset('resync');
              return;
            }
            if (!(await resumeFrom(current, now, since, at))) return;
          } else if (now.from === 'beginning' && !(await snapshot(current, now))) {
            return;
          }
          // What the reader delivered while the start was read is not held batch by batch (a long
          // snapshot would overflow the bound, and the client could only start again): the stream
          // reads the range it covers from the log as a resume does, until it has caught up.
          let covered = at;
          for (;;) {
            // The range and the flag are read together: every batch up to `target` was delivered
            // before this revalidation starts, and a batch that arrives while it waits gets its own.
            const target = arrived.to;
            const dependency = arrived.dependency;
            arrived.dependency = false;
            if (dependency) {
              await input.revalidate(subscription);
              if (ended()) return;
            }
            if (target <= covered) break;
            if (!(await resumeFrom(current, view ?? now, covered, target))) return;
            covered = target;
          }
          floor = covered;
          if (!emit({ control: 'head', state: (view ?? now).token(covered) })) return;
          phase = 'live';
          held.flush();
        } catch (error) {
          if (!ended()) failWith(error);
        }
      };

      const listener: ReaderListener = {
        get view() {
          return view;
        },
        join: (at) => {
          joinAt?.(at);
          joinAt = undefined;
        },
        undecided: (batch) => {
          if (ended() || view === undefined) return [];
          // The reader asks inside the pass's unit and delivers after the unit has closed, so what the
          // set holds when the batch is applied may differ from what it holds now: the start's replay
          // and a batch held for a revalidation both change it. Until the stream is live and nothing
          // is held, no member counts as known and every stream that is not visible and not created
          // is named.
          const known: VisibilitySet =
            phase === 'live' && held.idle() ? set : { ...set, exact: false, has: () => false };
          return changesOfBatch({ view, batch, set: known, floor }).unknown;
        },
        deliver: (batch) => {
          if (phase !== 'starting') held.deliver(batch);
          else if (!ended()) {
            arrived.to = batch.to;
            arrived.dependency ||= held.touchesDependency(batch);
          }
        },
        extraStreamTypes: held.extraStreamTypes,
        fail,
        end: () => {
          buffer.close();
          end();
        },
      };

      const subscription: LiveSubscription = {
        get session() {
          return session;
        },
        renew: async (next) => {
          if (ended() || kernel === undefined || view === undefined) return;
          const fresh = await kernel.view(next, input.input);
          if (ended() || view === undefined) return;
          if (fresh.planKey !== view.planKey) {
            reset('resync');
            return;
          }
          view = fresh;
          session = next;
        },
        fail,
      };

      const member: HubMember = {
        subscription,
        close: async () => {
          buffer.close();
          end();
          while (pending.size > 0) await Promise.all([...pending]);
        },
      };

      const start = async (): Promise<void> => {
        // The hub lists the member before anything is awaited, so a hub that closes while the view
        // is built ends this stream too; after every await the stream may have ended, and then nothing is attached.
        try {
          unregister = input.register(member);
          const current = liveKernelOf(session, input.entity);
          kernel = current;
          const built = await current.view(session, input.input);
          if (ended()) return;
          view = built;
          if ((input.resume ?? built.after) !== undefined) set.markPartial();
          const joined = new Promise<Position>((resolve) => {
            joinAt = resolve;
          });
          phase = 'joining';
          detach = input.readers.attach(current, listener);
          void joined.then(begin);
        } catch (error) {
          end();
          throw error;
        }
      };

      return {
        next: async () => {
          if (failed || (ended() && setup === undefined)) {
            return { done: true, value: undefined };
          }
          setup ??= start();
          try {
            await setup;
          } catch (error) {
            failed = true;
            throw error;
          }
          return buffer.next() as Promise<IteratorResult<LiveFrame<EntityChange<unknown>>>>;
        },
        return: async () => {
          buffer.close();
          end();
          return { done: true, value: undefined };
        },
      };
    },
  };
}
