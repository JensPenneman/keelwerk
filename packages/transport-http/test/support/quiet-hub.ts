import type { Invocation, LiveFrame } from '@keelwerk/core';

/** What a quiet subscription of the hub does: it waits for a change, ends when its signal aborts, and counts while it is open. */
export function quietHub(state: { open: number }) {
  return (invocation: Invocation<unknown>): AsyncIterable<LiveFrame<unknown>> =>
    (async function* () {
      state.open += 1;
      try {
        await new Promise<void>((resolve) =>
          invocation.signal.addEventListener('abort', () => resolve(), { once: true }),
        );
      } finally {
        state.open -= 1;
      }
    })();
}
