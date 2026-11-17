import type { Condition } from '../conditions/condition.ts';
import { evaluateCondition } from '../conditions/evaluate-condition.ts';
import type { EffectStatus } from '../effects/effect-status.ts';
import { effectStatusOf } from '../effects/effect-status-of.ts';
import type { LiveFrame } from '../invoker/live-frame.ts';

/** The row of a created, changed or restored frame, when it is one. */
function rowOf(event: unknown): Readonly<Record<string, unknown>> | undefined {
  if (typeof event !== 'object' || event === null) return undefined;
  const type: unknown = Reflect.get(event, 'type');
  if (type !== 'created' && type !== 'changed' && type !== 'restored') return undefined;
  const row: unknown = Reflect.get(event, 'row');
  return typeof row === 'object' && row !== null
    ? (row as Readonly<Record<string, unknown>>)
    : undefined;
}

/** The status of the frame's row when it is the submitter's own, else undefined. */
function statusOfFrame(event: unknown, where: Condition): EffectStatus | undefined {
  const row = rowOf(event);
  if (row === undefined) return undefined;
  try {
    if (!evaluateCondition(where, row)) return undefined;
  } catch {
    // A condition the row cannot answer matches nothing.
    return undefined;
  }
  return effectStatusOf(row);
}

/**
 * The hub's `core.effect` frames as status items: a created, changed or restored row for which
 * `evaluateCondition(where, row)` holds becomes `effectStatusOf(row)` with the frame's own state
 * (none before `head`); every other data frame (removed, archived, another submitter's row, a row
 * `effectStatusOf` refuses) is dropped; control frames pass unchanged; `return()` reaches the inner
 * stream. Holds nothing, logs nothing.
 */
export function effectStatusFrames(
  frames: AsyncIterable<LiveFrame<unknown>>,
  where: Condition,
): AsyncIterable<LiveFrame<EffectStatus>> {
  return {
    [Symbol.asyncIterator]: () => {
      const inner = frames[Symbol.asyncIterator]();
      const iterator: AsyncIterator<LiveFrame<EffectStatus>> = {
        next: async () => {
          for (;;) {
            const step = await inner.next();
            if (step.done === true) return { done: true, value: undefined };
            const frame = step.value;
            if ('control' in frame) return { done: false, value: frame };
            const status = statusOfFrame(frame.event, where);
            if (status === undefined) continue;
            return {
              done: false,
              value:
                frame.state === undefined
                  ? { event: status }
                  : { event: status, state: frame.state },
            };
          }
        },
        return: async (value?: unknown) => {
          await inner.return?.(value);
          return { done: true, value: undefined };
        },
      };
      return iterator;
    },
  };
}
