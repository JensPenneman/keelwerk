import type { ActionPart, Execution, PartTypes } from '../model/action-part.ts';
import type { EnqueueEffect } from '../protocol/enqueue-effect.ts';
import { refOf } from './ref-of.ts';

type AnyCommand = ActionPart<'command', unknown, string | null, Execution, PartTypes>;

/** Options of the enqueue effect. */
export interface EnqueueOptions {
  readonly runAt?: Temporal.Instant;
  readonly key?: string;
  readonly commandId?: string;
}

/** Enqueues a command job, committed with the unit and run after commit in any scope (section 7.9.5). */
export function enqueue<const A extends AnyCommand>(
  action: A,
  input: NonNullable<A['~types']>['input'],
  options?: EnqueueOptions,
): EnqueueEffect;
export function enqueue(action: string, input: unknown, options?: EnqueueOptions): EnqueueEffect;
export function enqueue(
  action: AnyCommand | string,
  input: unknown,
  options: EnqueueOptions = {},
): EnqueueEffect {
  return Object.freeze({
    kind: 'enqueue',
    type: 'enqueue',
    action: refOf(action),
    input,
    ...(options.runAt === undefined ? {} : { runAt: options.runAt }),
    ...(options.key === undefined ? {} : { key: options.key }),
    ...(options.commandId === undefined ? {} : { commandId: options.commandId }),
  });
}
