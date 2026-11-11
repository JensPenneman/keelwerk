import type { ActionPart, Execution, PartTypes } from '../model/action-part.ts';
import type { InvokeEffect } from '../protocol/invoke-effect.ts';
import { refOf } from './ref-of.ts';
import type { SystemReason } from './system.ts';

type AnyCommand = ActionPart<'command', unknown, string | null, Execution, PartTypes>;

/** Options of the invoke effect. */
export interface InvokeOptions {
  readonly as?: SystemReason;
  readonly prefer?: 'sync' | 'async';
  /** Maps the invoked command's error codes to the codes this decision's caller sees. */
  readonly errors?: Readonly<Record<string, string>>;
}

/**
 * Invokes a command after the decision's events: own actions by value, the commands of required
 * modules by reference (section 7.9.5). The payload is frozen and carries the action's reference.
 */
export function invoke<const A extends AnyCommand>(
  action: A,
  input: NonNullable<A['~types']>['input'],
  options?: InvokeOptions,
): InvokeEffect;
export function invoke(action: string, input: unknown, options?: InvokeOptions): InvokeEffect;
export function invoke(
  action: AnyCommand | string,
  input: unknown,
  options: InvokeOptions = {},
): InvokeEffect {
  return Object.freeze({
    kind: 'invoke',
    type: 'invoke',
    action: refOf(action),
    input,
    ...(options.as === undefined ? {} : { as: options.as }),
    ...(options.prefer === undefined ? {} : { prefer: options.prefer }),
    ...(options.errors === undefined ? {} : { errors: Object.freeze({ ...options.errors }) }),
  });
}
