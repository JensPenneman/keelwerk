import { errors } from '../errors/errors.ts';
import type { StateToken } from '../events/state-token.ts';
import type { Invocation } from '../invoker/invocation.ts';
import type { Invoker } from '../invoker/invoker.ts';
import type { LiveFrame } from '../invoker/live-frame.ts';
import type { ServiceGate } from './service-gate.ts';

/**
 * Wraps `subscribe` so that a closed gate (a restore found under the running process) refuses a
 * new subscription and ends a running one: the first `next()` of a subscription started after the
 * gate closed throws `core.unavailable`, and so does the pending `next()` of one that was running
 * when it closed, after its source iterator is returned. The iterator keeps one reaction on the
 * gate's signal, however many items it yields, and removes it when the subscription returns,
 * finishes or fails, so that a process that never closes keeps nothing of a finished one.
 */
export function gatedSubscribe(
  subscribe: Invoker['subscribe'],
  gate: ServiceGate,
): Invoker['subscribe'] {
  return <I, E>(
    inv: Invocation<I>,
    resume?: { readonly after: StateToken },
  ): AsyncIterable<LiveFrame<E>> => ({
    [Symbol.asyncIterator]: () => {
      const refused = () => errors.unavailable('The process is out of service after a restore.');
      let source: AsyncIterator<LiveFrame<E>> | undefined;
      let waiting: ((error: unknown) => void) | undefined;
      let ended = false;
      let finished = false;
      const release = (): void => {
        gate.signal.removeEventListener('abort', end);
        source = undefined;
      };
      function end(): void {
        ended = true;
        void source?.return?.().catch(() => undefined);
        waiting?.(refused());
        release();
      }
      if (gate.closed) ended = true;
      else gate.signal.addEventListener('abort', end, { once: true });
      return {
        next: () =>
          new Promise<IteratorResult<LiveFrame<E>>>((resolve, reject) => {
            if (ended) {
              reject(refused());
              return;
            }
            if (finished) {
              resolve({ done: true, value: undefined });
              return;
            }
            source ??= subscribe<I, E>(inv, resume)[Symbol.asyncIterator]();
            waiting = reject;
            source.next().then(
              (result) => {
                waiting = undefined;
                if (result.done === true) {
                  finished = true;
                  release();
                }
                resolve(result);
              },
              (error: unknown) => {
                waiting = undefined;
                finished = true;
                release();
                reject(error);
              },
            );
          }),
        return: async () => {
          ended = true;
          const closing = source;
          release();
          await closing?.return?.();
          return { done: true, value: undefined };
        },
      };
    },
  });
}
