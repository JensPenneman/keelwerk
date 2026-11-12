import type { LiveFrame } from '../src/invoker/live-frame.ts';
import type { LiveEffectsPlan } from '../src/live/live-effects-plan.ts';
import { pendingEffectFrames } from '../src/live/pending-effect-frames.ts';
import type { EffectEntry } from '../src/registry/effect-entry.ts';

export const plainEntry = { module: 'dispatch', input: {} } as unknown as EffectEntry;
export const pendingBound = 1000;

export const state = (value: string) => value as never;

export function effectRow(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    type: 'dispatch.ship',
    status: 'requested',
    performer: 'external',
    input: { parcel: `p-${id}`, depot: 'north', recipient: { $kwe: 'sealed' } },
    ...over,
  };
}

export function createdFrame(
  id: string,
  over: Record<string, unknown> = {},
  at?: string,
): LiveFrame<unknown> {
  const frame = { event: { type: 'created', id, version: 1, row: effectRow(id, over) } };
  return at === undefined ? frame : { ...frame, state: state(at) };
}

export const headFrame = (at: string): LiveFrame<unknown> => ({
  control: 'head',
  state: state(at),
});

export function source(frames: readonly LiveFrame<unknown>[], onReturn?: () => void) {
  return {
    [Symbol.asyncIterator]: () => {
      let index = 0;
      return {
        next: async () =>
          index < frames.length
            ? { done: false as const, value: frames[index++] as LiveFrame<unknown> }
            : { done: true as const, value: undefined },
        return: async () => {
          onReturn?.();
          return { done: true as const, value: undefined };
        },
      };
    },
  };
}

export async function collect(
  frames: readonly LiveFrame<unknown>[],
  plan: {
    plain?: readonly string[];
    where?: unknown;
    entry?: EffectEntry;
    after?: string;
    maxHeld?: number;
  } = {},
) {
  const seen: LiveFrame<unknown>[] = [];
  const stream = pendingEffectFrames(
    source(frames),
    {
      plain: plan.plain ?? ['parcel', 'depot'],
      where: plan.where as never,
      entry: plan.entry ?? plainEntry,
      after: plan.after as LiveEffectsPlan['after'],
    },
    plan.maxHeld ?? pendingBound,
  );
  for await (const frame of stream) seen.push(frame);
  return seen;
}

export const idsOf = (frames: readonly LiveFrame<unknown>[]) =>
  frames.map((frame) => ('control' in frame ? frame.control : (frame.event as { id: string }).id));
