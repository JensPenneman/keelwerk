import { KeelwerkError } from '../errors/keelwerk-error.ts';
import type { InvocationSession } from '../invoker/invocation-session.ts';
import type { LiveFrame } from '../invoker/live-frame.ts';
import type { LiveEffectsPlan } from './live-effects-plan.ts';
import type { LiveHub } from './live-hub.ts';
import type { LiveMapDriver } from './live-map-driver.ts';
import type { LivePokesPlan } from './live-pokes-plan.ts';
import type { LiveSourcePlan } from './live-source-plan.ts';
import { pendingEffectFrames } from './pending-effect-frames.ts';

/** What a stream holds until its `head` when the hub states no bound: the hub's own default for a subscriber's queue. */
const defaultMaxHeld = 1000;

function isGenerator(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof Reflect.get(value, 'next') === 'function' &&
    typeof Reflect.get(value, Symbol.iterator) === 'function'
  );
}

/**
 * Runs a source plan (7.9.2): the hub serves the plan's entity under its input (or the pokes of the
 * session's scope; for the pending effects of an effect, the rows of `core.effect` as pending
 * effects, `pendingEffectFrames`), resumed from its `after`, and the maps are applied to every item in array order; an item a map answers
 * `undefined` for is dropped together with its state. Control frames pass unchanged. A map that
 * answers a generator is driven by `drive`, one read-only unit per item, and its result is the
 * mapped item; without `drive` it is `not_implemented`. The work starts when iteration starts.
 */
export function runLiveSource(
  hub: LiveHub,
  session: InvocationSession,
  plan: LiveSourcePlan | LivePokesPlan | LiveEffectsPlan,
  drive?: LiveMapDriver,
): AsyncIterable<LiveFrame<unknown>> {
  const applied = plan.maps;
  const served: AsyncIterable<LiveFrame<unknown>> =
    plan.kind === 'pokes'
      ? hub.pokes(session, plan.after)
      : plan.kind === 'effects'
        ? pendingEffectFrames(
            hub.entity<unknown>(session, plan.entity, plan.input, plan.after),
            plan,
            hub.limits?.maxBufferedItems ?? defaultMaxHeld,
          )
        : hub.entity<unknown>(session, plan.entity, plan.input, plan.after);
  return {
    [Symbol.asyncIterator]: () => {
      const inner = served[Symbol.asyncIterator]();
      // Aborted by `return()`: a map unit that is open when the client goes ends with it.
      const stopped = new AbortController();
      const iterator: AsyncIterator<LiveFrame<unknown>> = {
        next: async () => {
          for (;;) {
            const step = await inner.next();
            if (step.done === true) return { done: true, value: undefined };
            const frame = step.value;
            if ('control' in frame) return { done: false, value: frame };
            let item: unknown = frame.event;
            for (const map of applied) {
              item = map(item);
              if (isGenerator(item)) {
                if (drive !== undefined) {
                  try {
                    item = await drive(
                      item as Generator<unknown, unknown, unknown>,
                      stopped.signal,
                    );
                  } catch (error) {
                    if (stopped.signal.aborted) return { done: true, value: undefined };
                    throw error;
                  }
                } else {
                  throw new KeelwerkError({
                    kind: 'not_implemented',
                    code: 'core.not_implemented',
                    message: 'A generator map of a live source is not available in this release.',
                  });
                }
              }
              if (item === undefined) break;
            }
            if (item === undefined) continue;
            return {
              done: false,
              value:
                frame.state === undefined ? { event: item } : { event: item, state: frame.state },
            };
          }
        },
        return: async (value?: unknown) => {
          stopped.abort();
          return (await inner.return?.(value)) ?? { done: true, value: undefined };
        },
      };
      return iterator;
    },
  };
}
