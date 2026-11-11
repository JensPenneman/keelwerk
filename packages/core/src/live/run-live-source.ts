import { KeelwerkError } from '../errors/keelwerk-error.ts';
import type { InvocationSession } from '../invoker/invocation-session.ts';
import type { LiveFrame } from '../invoker/live-frame.ts';
import type { EntityChange } from '../model/entity-change.ts';
import type { LiveHub } from './live-hub.ts';
import type { LiveSourcePlan } from './live-source-plan.ts';

function isGenerator(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof Reflect.get(value, 'next') === 'function' &&
    typeof Reflect.get(value, Symbol.iterator) === 'function'
  );
}

/**
 * Runs a source plan (7.9.2): the hub serves the plan's entity under its input, resumed from its
 * `after`, and the maps are applied to every item in array order; an item a map answers
 * `undefined` for is dropped together with its state. Control frames pass unchanged. A map that
 * answers a generator is `not_implemented`. The work starts when iteration starts.
 */
export function runLiveSource(
  hub: LiveHub,
  session: InvocationSession,
  plan: LiveSourcePlan,
): AsyncIterable<LiveFrame<unknown>> {
  const applied = plan.maps;
  const served = hub.entity<unknown>(session, plan.entity, plan.input, plan.after);
  return {
    [Symbol.asyncIterator]: () => {
      const inner = served[Symbol.asyncIterator]();
      const iterator: AsyncIterator<LiveFrame<unknown>> = {
        next: async () => {
          for (;;) {
            const step = await inner.next();
            if (step.done === true) return { done: true, value: undefined };
            const frame = step.value;
            if ('control' in frame) return { done: false, value: frame };
            let item: unknown = frame.event as EntityChange<unknown>;
            for (const map of applied) {
              item = map(item);
              if (isGenerator(item)) {
                throw new KeelwerkError({
                  kind: 'not_implemented',
                  code: 'core.not_implemented',
                  message: 'A generator map of a live source is not available in this release.',
                });
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
        return: async (value?: unknown) =>
          (await inner.return?.(value)) ?? { done: true, value: undefined },
      };
      return iterator;
    },
  };
}
