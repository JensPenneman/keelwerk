import { evaluateCondition } from '../conditions/evaluate-condition.ts';
import { holdsSealedValue } from '../effects/holds-sealed-value.ts';
import type { PendingEffect } from '../effects/pending-effect.ts';
import type { StateToken } from '../events/state-token.ts';
import type { LiveFrame } from '../invoker/live-frame.ts';
import { decodeShapeValue } from '../write-path/decode-shape-value.ts';
import type { LiveEffectsPlan } from './live-effects-plan.ts';

/** A pending effect before it has its state. */
interface HeldEffect {
  readonly id: string;
  readonly type: string;
  readonly input: Readonly<Record<string, unknown>>;
  readonly deadline?: Temporal.Instant;
}

/** What the hub tells of a `core.effect` row. */
interface RowChange {
  readonly type: string;
  readonly id: string;
  readonly row?: Readonly<Record<string, unknown>>;
}

/** The plain members of a stored input; a value that holds a sealed value is left out, whatever the member's flags were when it was stored. */
function plainInputOf(
  stored: unknown,
  plain: ReadonlySet<string>,
): Readonly<Record<string, unknown>> {
  const input: Record<string, unknown> = {};
  if (typeof stored !== 'object' || stored === null) return input;
  for (const name of plain) {
    if (!Object.hasOwn(stored, name)) continue;
    const value: unknown = Reflect.get(stored, name);
    if (!holdsSealedValue(value)) input[name] = value;
  }
  return input;
}

/** The pending effect a row is, or undefined when it is not `requested` or its input does not match `where`. */
function pendingOf(
  change: RowChange,
  plan: Pick<LiveEffectsPlan, 'where' | 'entry'>,
  plain: ReadonlySet<string>,
): HeldEffect | undefined {
  const { row } = change;
  if (row === undefined || row.status !== 'requested') return undefined;
  let input: Readonly<Record<string, unknown>>;
  try {
    input = decodeShapeValue(
      plan.entry.input,
      plan.entry.module,
      plainInputOf(row.input, plain),
    ) as Readonly<Record<string, unknown>>;
  } catch {
    // A stored value its field cannot read matches nothing, like a condition the input cannot answer.
    return undefined;
  }
  if (plan.where !== undefined) {
    try {
      if (!evaluateCondition(plan.where, input)) return undefined;
    } catch {
      // A condition the input cannot answer matches nothing.
      return undefined;
    }
  }
  return {
    id: String(row.id),
    type: String(row.type),
    input,
    ...(row.deadline instanceof Temporal.Instant ? { deadline: row.deadline } : {}),
  };
}

/**
 * The hub's `core.effect` frames as pending effects (D3): what arrives before `head` (start and
 * catch-up items, which carry no state) is held by id until `head`; a created, changed or restored
 * row that is `requested` and matches `where` becomes a PendingEffect whose input holds only the
 * plain members, decoded to domain values; removals, archives and other rows are dropped; control
 * frames pass; `reset` drops what is held; `return()` reaches the inner stream. A held id is
 * replaced by a later item and deleted by a removal or a row that is no longer pending, so an effect
 * a deadline failed between the snapshot and `head` never reaches the performer. After `head` a
 * removal is dropped: a performer learns of a settle it missed by the `conflict` of its own.
 *
 * An item released at `head` carries the state the stream was opened with (`plan.after`), or none
 * on a fresh start, never the state of `head`: that token says everything up to `head` was
 * delivered, which is true only once the whole batch was, so a performer that reconnects after the
 * first item is served the same catch-up again (at least once, never skipped). `head` keeps the
 * token that covers the batch. At most `maxHeld` effects are held: when one more arrives the held
 * items are released with the same state and the rest of the catch-up passes straight through to
 * `head` (a pending row is an item, a removal or a row no longer pending is dropped), so a backlog
 * larger than the bound is still delivered and memory stays bounded by `maxHeld`. An effect a
 * deadline failed after it was released may reach the performer; its settle answers `conflict`.
 */
export function pendingEffectFrames(
  frames: AsyncIterable<LiveFrame<unknown>>,
  plan: Pick<LiveEffectsPlan, 'plain' | 'where' | 'entry' | 'after'>,
  maxHeld: number,
): AsyncIterable<LiveFrame<PendingEffect<unknown>>> {
  const plain = new Set(plan.plain);
  return {
    [Symbol.asyncIterator]: () => {
      const inner = frames[Symbol.asyncIterator]();
      const held = new Map<string, HeldEffect>();
      const ready: LiveFrame<PendingEffect<unknown>>[] = [];
      let live = false;
      let ended = false;
      let streaming = false;
      let latest: StateToken | undefined;
      const itemOf = (
        effect: HeldEffect,
        state: StateToken | undefined,
      ): LiveFrame<PendingEffect<unknown>> =>
        state === undefined
          ? { event: effect as unknown as PendingEffect<unknown> }
          : { event: { ...effect, state } as unknown as PendingEffect<unknown>, state };
      const iterator: AsyncIterator<LiveFrame<PendingEffect<unknown>>> = {
        next: async () => {
          for (;;) {
            const queued = ready.shift();
            if (queued !== undefined) return { done: false, value: queued };
            if (ended) return { done: true, value: undefined };
            const step = await inner.next();
            if (step.done === true) return { done: true, value: undefined };
            const frame = step.value;
            if ('control' in frame) {
              if (frame.control === 'head') {
                latest = frame.state;
                for (const effect of held.values()) ready.push(itemOf(effect, plan.after));
                held.clear();
                live = true;
              } else if (frame.control === 'reset') {
                held.clear();
                streaming = false;
              }
              ready.push(frame);
              continue;
            }
            const change = frame.event as RowChange;
            const pending =
              change.type === 'created' || change.type === 'changed' || change.type === 'restored'
                ? pendingOf(change, plan, plain)
                : undefined;
            if (!live) {
              if (streaming) {
                if (pending !== undefined) ready.push(itemOf(pending, plan.after));
                continue;
              }
              if (pending === undefined) {
                held.delete(String(change.id));
                continue;
              }
              held.set(pending.id, pending);
              if (held.size > maxHeld) {
                for (const effect of held.values()) ready.push(itemOf(effect, plan.after));
                held.clear();
                streaming = true;
              }
              continue;
            }
            if (pending === undefined) continue;
            const state = frame.state ?? latest;
            if (state === undefined) continue;
            latest = state;
            ready.push(itemOf(pending, state));
          }
        },
        return: async (value?: unknown) => {
          held.clear();
          ended = true;
          await inner.return?.(value);
          return { done: true, value: undefined };
        },
      };
      return iterator;
    },
  };
}
