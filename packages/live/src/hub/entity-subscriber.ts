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
import type { HubMember } from './hub-member.ts';
import { limitedRead } from './limited-read.ts';
import type { LiveSubscription } from './live-subscription.ts';
import type { ReaderBatch } from './reader-batch.ts';
import type { ReaderListener } from './reader-listener.ts';
import type { ResolvedHubLimits } from './resolve-hub-limits.ts';
import type { ScopeReaders } from './scope-readers.ts';
import type { StartLimiter } from './start-limiter.ts';
import { createSubscriptionBuffer } from './subscription-buffer.ts';
import { createVisibilitySet } from './visibility-set.ts';

/** Rows of a snapshot per read, and streams judged per replay read (D3, D7). */
const snapshotPage = 100;
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
  /** Lists the member with the hub, the moment the subscription starts; answers how to remove it. */
  readonly register: (member: HubMember) => () => void;
}

/**
 * One subscription's state machine (15.4.3 to 15.4.5, D3, D6, D8). Iteration starts it: it builds its
 * view and attaches to the reader of its scope; once the reader's first pass has joined it, it reads
 * its start (the rows of `from: 'beginning'`, or the replay of a resume) in units of its own, sends
 * `head`, then follows the batches the reader delivers, which it held in the meantime. Items go
 * through a bounded buffer; a buffer that overflows is replaced by `reset` `overflow`. Whatever a
 * unit or a reader fails with ends the stream: `next()` throws. The hub closes it through its
 * member: the stream ends without a frame or an error and a pending `next()` is done. The start
 * reads wait for a slot of the hub's start limiter; the batches the reader delivers meanwhile are held.
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
      let held: ReaderBatch[] = [];
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
        held = [];
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

      const snapshot = async (current: LiveKernel, now: LiveView): Promise<boolean> => {
        const read = limitedRead({ kernel: current, startUnits: input.startUnits, abort, pending });
        let after: string | undefined;
        for (;;) {
          await buffer.whenBelowHalf();
          if (ended()) return false;
          const page = await read(
            async (unit) => {
              const found = await unit.rows.find(current.descriptor, {
                where: now.selection,
                sort: [{ field: 'id', direction: 'asc' }],
                page: { first: snapshotPage, ...(after === undefined ? {} : { after }) },
                ...(now.includeArchived ? { includeArchived: true } : {}),
              });
              const rows = found.rows.filter((row) => now.inFilter(row));
              return { found, rows, shown: await now.present(unit, rows) };
            },
            { timeoutMs: limits.passTimeoutMs },
          );
          for (const [index, row] of page.rows.entries()) {
            const shown = page.shown[index];
            if (shown === undefined) continue;
            const id = String(row.id);
            const archived = row.archivedAt !== undefined && row.archivedAt !== null;
            const event = {
              type: archived ? 'archived' : 'changed',
              id,
              version: Number(row.version),
              row: now.project(shown),
            } as EntityChange<unknown>;
            if (!emit({ event })) return false;
            set.add(id);
          }
          if (!page.found.pageInfo.hasNextPage || page.found.pageInfo.endCursor === null) {
            return true;
          }
          after = page.found.pageInfo.endCursor;
        }
      };

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
          if (!emit({ control: 'head', state: now.token(at) })) return;
          phase = 'live';
          const batches = held;
          held = [];
          for (const batch of batches) {
            apply(batch);
            if (ended()) return;
          }
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
          if (ended() || view === undefined || set.exact) return [];
          return changesOfBatch({ view, batch, set, floor }).unknown;
        },
        deliver: (batch) => {
          if (ended()) return;
          if (phase === 'live') apply(batch);
          else if (held.length >= limits.maxHeldBatches) reset('overflow');
          else held.push(batch);
        },
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
