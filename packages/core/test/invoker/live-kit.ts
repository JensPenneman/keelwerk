import { vi } from 'vitest';
import type { KeelwerkError } from '../../src/errors/keelwerk-error.ts';
import type { StateToken } from '../../src/events/state-token.ts';
import { field } from '../../src/fields/field.ts';
import { shape } from '../../src/fields/shape.ts';
import type { LiveFrame } from '../../src/invoker/live-frame.ts';
import type { LiveHub } from '../../src/live/live-hub.ts';
import { actionOf, invokerOf, registryOf, withResolver } from './invoker-kit.ts';

/** The leaf of a custom subscription: the changes of `doc.post`, resumed from `after`, under `where`. */
export const leaf = (after?: unknown, where?: unknown) => ({
  kind: 'liveSource',
  source: {
    kind: 'entity',
    entity: 'doc.post',
    options: {
      ...(after === undefined ? {} : { after }),
      ...(where === undefined ? {} : { where }),
    },
  },
});

/** A public subscription over `doc.post` whose items are `{ n }`. */
export const feed = actionOf('doc.feed', {
  kind: 'subscription',
  auth: 'public',
  input: shape({}),
  output: shape({ n: field.integer() }),
  handler: (_input: unknown, _ctx: unknown, resume: unknown) => leaf(resume),
});

/** A hub that answers the frames it is given and remembers how it was called; `onEntity` runs at each call. */
export function fakeHub(frames: readonly LiveFrame<unknown>[], onEntity?: () => void) {
  const calls: unknown[][] = [];
  const returned = vi.fn();
  const hub = {
    entity: (...args: unknown[]) => {
      onEntity?.();
      calls.push(args);
      return {
        [Symbol.asyncIterator]: () => {
          let at = 0;
          return {
            next: async () =>
              at < frames.length
                ? { done: false as const, value: frames[at++] as LiveFrame<unknown> }
                : await new Promise<never>(() => undefined),
            return: async () => {
              returned();
              return { done: true as const, value: undefined };
            },
          };
        },
      };
    },
    pokes: () => {
      throw new Error('not used');
    },
    stream: () => {
      throw new Error('not used');
    },
    topic: () => {
      throw new Error('not used');
    },
  } as unknown as LiveHub;
  return { hub, calls, returned };
}

/** An invoker whose app was given this hub. */
export const withHub = (
  hub: LiveHub,
  actions = [feed],
  over: Parameters<typeof invokerOf>[1] = {},
) => invokerOf(withResolver(registryOf(actions)), over, { liveHub: hub });

export const head = { control: 'head', state: 'v2.0.1.aaaaaaaa.bbbbbbbb' as StateToken } as const;
export const itemFrame = (n: number): LiveFrame<unknown> => ({
  event: { n },
  state: `v2.0.${n + 1}.aaaaaaaa.bbbbbbbb` as StateToken,
});

/** Reads the stream to its end and answers the error it failed with. */
export async function streamFailure(iterable: AsyncIterable<unknown>): Promise<KeelwerkError> {
  try {
    for await (const _frame of iterable) {
      // every frame is read
    }
  } catch (error) {
    return error as KeelwerkError;
  }
  throw new Error('the stream did not fail');
}
