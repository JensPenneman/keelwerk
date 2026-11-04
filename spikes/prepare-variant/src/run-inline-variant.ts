import type { ActionEntry, CommandResult, RunCommandInput } from '@keelwerk/core';
import { runCommand } from '@keelwerk/core';
import { inlineEffectAfterLoad } from './inline-effect-after-load.ts';
import { isGenerator } from './is-generator.ts';
import { replayMismatch } from './replay-mismatch.ts';

interface Yielded {
  readonly kind?: unknown;
  readonly effect?: { readonly type?: unknown };
}

function kindOf(value: unknown): unknown {
  return typeof value === 'object' && value !== null ? (value as Yielded).kind : undefined;
}

function effectTypeOf(value: unknown): string {
  const type =
    typeof value === 'object' && value !== null ? (value as Yielded).effect?.type : undefined;
  return typeof type === 'string' ? type : 'an effect';
}

function preludeOf(action: ActionEntry): ActionEntry['prepare'] {
  return function* prelude(...args: readonly unknown[]): Generator<unknown, unknown, unknown> {
    const handled = action.handler(...args);
    const outcomes: unknown[] = [];
    if (!isGenerator(handled)) return outcomes;
    let step = handled.next();
    while (step.done !== true && kindOf(step.value) === 'perform') {
      const outcome: unknown = yield step.value;
      outcomes.push(outcome);
      step = handled.next(outcome);
    }
    if (step.done !== true) handled.return(undefined);
    return outcomes;
  };
}

function replayOf(action: ActionEntry): ActionEntry['handler'] {
  return function* replay(...args: readonly unknown[]): Generator<unknown, unknown, unknown> {
    const ctx = args.at(-1) as { readonly prepared: readonly unknown[] };
    const outcomes = ctx.prepared;
    let served = 0;
    let loaded = false;
    const perform = (effect: unknown): unknown => ({
      kind: 'perform',
      effect,
      *[Symbol.iterator](): Generator<unknown, unknown, unknown> {
        return yield this;
      },
    });
    const inner = action.handler(
      ...args.slice(0, -1),
      Object.create(ctx, { perform: { value: perform } }),
    );
    if (!isGenerator(inner)) return inner;
    let step = inner.next();
    while (step.done !== true) {
      const request = step.value;
      if (kindOf(request) === 'perform') {
        if (loaded) throw inlineEffectAfterLoad(effectTypeOf(request), action.ref);
        if (served >= outcomes.length) throw replayMismatch(action.ref, served, outcomes.length);
        const outcome = outcomes[served];
        served += 1;
        step = inner.next(outcome);
        continue;
      }
      if (!loaded && served !== outcomes.length) {
        throw replayMismatch(action.ref, served, outcomes.length);
      }
      loaded = true;
      const answer: unknown = yield request;
      step = inner.next(answer);
    }
    return step.value;
  } as ActionEntry['handler'];
}

/**
 * The driver of the inline-before-load form. Phase one runs `decide` until its first request that
 * is not an inline effect: each effect is yielded to the kernel, which hands it to the inline
 * executor, and the outcomes are the value `ctx.prepared` carries into the unit. No read-write
 * unit exists yet. Phase two is the kernel's own unit: the same `decide` runs again, answers every
 * effect it requested before its first load from those outcomes, and refuses an effect it requests
 * after a load with `core.effect_after_load`. A retried unit replays the outcomes, never the effect.
 */
export function runInlineVariant(input: RunCommandInput): Promise<CommandResult> {
  const { action } = input;
  const variant: ActionEntry = {
    ...action,
    prepare: preludeOf(action) as NonNullable<ActionEntry['prepare']>,
    handler: replayOf(action),
  };
  return runCommand({ ...input, action: variant });
}
