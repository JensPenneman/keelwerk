import type {
  InvocationSession,
  LiveFrame,
  LiveHub,
  LiveKernel,
  LivePokesView,
  Poke,
  Position,
  StateToken,
  StoredEvent,
} from '@keelwerk/core';
import { errors, KeelwerkError, liveKernelOf, livePokesViewOf } from '@keelwerk/core';
import { createHeldBatches } from '../hub/held-batches.ts';
import type { HubMember } from '../hub/hub-member.ts';
import type { LiveSourceHub } from '../hub/live-source-hub.ts';
import type { LiveSubscription } from '../hub/live-subscription.ts';
import type { ReaderBatch } from '../hub/reader-batch.ts';
import type { ReaderListener } from '../hub/reader-listener.ts';
import type { ScopeReaders } from '../hub/scope-readers.ts';
import { createSubscriptionBuffer } from '../hub/subscription-buffer.ts';

/** The entity whose kernel gives the pokes their reader: its scope is the session's own scope. */
const readerEntity = 'core.commandReceipt';

type Phase = 'new' | 'joining' | 'live' | 'ended';

/**
 * The hub's `pokes` member (15.2.5): a view-less listener on the reader of the session's own scope.
 * Per batch whose events name an entity of the view: one item `{ upto, changed }` with the new
 * state token of each entity named, whose state is `upto`. A resume is judged at the join: a token
 * that is not current sends `reset` `resync` and ends; a position before the head sends one poke
 * at the head naming every entity of the view; an equal one sends nothing. There is no `head`
 * frame. A full buffer sends `reset` `overflow` with the last state and ends. A renewed session
 * whose view has another key sends `reset` `resync` without a state and ends. The hub closing ends
 * the stream without a frame.
 */
export function createPokesSource(readers: ScopeReaders, hub: LiveSourceHub): LiveHub['pokes'] {
  const { limits } = hub;
  return (bound: InvocationSession, resume?: StateToken): AsyncIterable<LiveFrame<Poke>> => ({
    [Symbol.asyncIterator]: () => {
      const buffer = createSubscriptionBuffer({
        maxItems: limits.maxBufferedItems,
        maxBytes: limits.maxBufferedBytes,
      });
      let session = bound;
      let view: LivePokesView | undefined;
      let phase: Phase = 'new';
      let floor: Position = 0n;
      let detach: (() => void) | undefined;
      let unregister: (() => void) | undefined;
      let setup: Promise<void> | undefined;
      let joinAt: ((at: Position) => void) | undefined;
      let failed = false;

      const ended = (): boolean => phase === 'ended';
      const end = (): void => {
        if (ended()) return;
        phase = 'ended';
        detach?.();
        unregister?.();
        held.clear();
      };
      const fail = (error: KeelwerkError): void => {
        buffer.fail(error);
        end();
      };
      const reset = (reason: 'overflow' | 'resync'): void => {
        const state = reason === 'overflow' ? buffer.lastDelivered : undefined;
        buffer.replaceWith({ control: 'reset', reason, ...(state === undefined ? {} : { state }) });
        end();
      };
      const emit = (frame: LiveFrame<Poke>): boolean => {
        if (ended()) return false;
        if (buffer.push(frame)) return true;
        reset('overflow');
        return false;
      };

      /** The poke at `position` that names `entities`. */
      const pokeAt = (now: LivePokesView, position: Position, entities: Iterable<string>): Poke => {
        const changed: Record<string, StateToken> = {};
        for (const entity of [...entities].sort())
          changed[entity] = now.stateToken(entity, position);
        return { upto: now.token(position), changed };
      };

      const held = createHeldBatches({
        session: () => session,
        revalidate: () => hub.revalidate(subscription),
        apply: (batch) => apply(batch),
        isLive: () => phase === 'live',
        ended,
        overflow: () => reset('overflow'),
        maxHeldBatches: limits.maxHeldBatches,
      });

      /** The kernels of the entities a change to which is named only for rows of the principal's plan. */
      const kernels = new Map<string, LiveKernel>();
      const rowKernels = (): LiveKernel[] =>
        [...(view?.conditional ?? [])].map((entity) => {
          let kernel = kernels.get(entity);
          if (kernel === undefined) {
            kernel = liveKernelOf(bound, entity);
            kernels.set(entity, kernel);
          }
          return kernel;
        });

      /** The entity types of the batch that concern the principal: a change to a row outside its plan is no one's business (15.4.9). */
      const namedIn = (now: LivePokesView, batch: ReaderBatch): Set<string> => {
        const byType = new Map<string, Map<string, StoredEvent[]>>();
        for (const event of batch.events) {
          const type = event.stream.type;
          if (!now.entities.has(type)) continue;
          const ids = byType.get(type) ?? new Map<string, StoredEvent[]>();
          const events = ids.get(event.stream.id) ?? [];
          events.push(event);
          ids.set(event.stream.id, events);
          byType.set(type, ids);
        }
        const named = new Set<string>();
        for (const [type, ids] of byType) {
          const rows = batch.rows.get(type);
          if (
            !now.conditional.has(type) ||
            now.concerns(
              type,
              [...ids].map(([id, events]) => ({ row: rows?.get(id), events })),
            )
          ) {
            named.add(type);
          }
        }
        return named;
      };

      const apply = (batch: ReaderBatch): void => {
        if (view === undefined || batch.to <= floor) return;
        const named = namedIn(view, batch);
        if (named.size === 0) return;
        const poke = pokeAt(view, batch.to, named);
        emit({ event: poke, state: poke.upto });
      };

      const begin = (at: Position): void => {
        const now = view;
        if (now === undefined) return;
        floor = at;
        try {
          if (resume !== undefined) {
            const since = now.judge(resume, at);
            if (since === 'resync') {
              reset('resync');
              return;
            }
            if (since < at && now.entities.size > 0) {
              const poke = pokeAt(now, at, now.entities);
              if (!emit({ event: poke, state: poke.upto })) return;
            }
          }
          phase = 'live';
          held.flush();
        } catch (error) {
          if (ended()) return;
          if (error instanceof KeelwerkError) fail(error);
          else fail(errors.unavailable('The live stream is not available now.'));
        }
      };

      const listener: ReaderListener = {
        join: (at) => {
          joinAt?.(at);
          joinAt = undefined;
        },
        rowKernels,
        deliver: held.deliver,
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
          if (ended() || view === undefined) return;
          const fresh = await livePokesViewOf(bound, next);
          if (ended() || view === undefined) return;
          if (fresh.key !== view.key) {
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
        },
      };

      const start = async (): Promise<void> => {
        try {
          unregister = hub.register(member);
          const current = liveKernelOf(session, readerEntity);
          view = await livePokesViewOf(bound, session);
          if (ended()) return;
          const joined = new Promise<Position>((resolve) => {
            joinAt = resolve;
          });
          phase = 'joining';
          detach = readers.attach(current, listener);
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
          return buffer.next() as Promise<IteratorResult<LiveFrame<Poke>>>;
        },
        return: async () => {
          buffer.close();
          end();
          return { done: true, value: undefined };
        },
      };
    },
  });
}
