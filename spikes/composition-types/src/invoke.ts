import type { ActionPart, Execution, PartTypes } from './action-part.ts';
import type { EffectDraft } from './decision.ts';

type AnyCommand = ActionPart<'command', unknown, string | null, Execution, PartTypes>;

/** Options of the invoke effect. */
export interface InvokeOptions {
  readonly as?: { readonly kind: 'system'; readonly reason: string };
  readonly prefer?: 'sync' | 'async';
}

/** Invokes a command after the decision's events: own actions by value (section 7.9.5). */
export function invoke<const A extends AnyCommand>(
  action: A,
  input: NonNullable<A['~types']>['input'],
  options?: InvokeOptions,
): EffectDraft<never> {
  return { kind: 'effect', type: 'invoke', ...{ action, input, options } };
}
