import type { ActionPart, Execution, PartTypes } from '../model/action-part.ts';
import type { SetTimerEffect } from '../protocol/set-timer-effect.ts';
import { refOf } from './ref-of.ts';

type AnyCommand = ActionPart<'command', unknown, string | null, Execution, PartTypes>;

/** When a timer fires: at an instant, or after a duration such as '45s'. */
export type TimerWhen =
  | { readonly at: Temporal.Instant; readonly after?: never }
  | { readonly after: string; readonly at?: never };

/** The literal of a keyed timer whose action is an own command by value. */
export type SetTimerSpec<A extends AnyCommand> = TimerWhen & {
  readonly key: string;
  readonly invoke: A;
  readonly input: NonNullable<A['~types']>['input'];
};

/** The literal of a keyed timer whose action is named by reference. */
export type SetTimerRefSpec = TimerWhen & {
  readonly key: string;
  readonly invoke: string;
  readonly input: unknown;
};

/** Sets a keyed timer job (section 9.5.1); `cancelTimer(key)` is the inverse. */
export function setTimer<const A extends AnyCommand>(spec: SetTimerSpec<A>): SetTimerEffect;
export function setTimer(spec: SetTimerRefSpec): SetTimerEffect;
export function setTimer(spec: SetTimerRefSpec | SetTimerSpec<AnyCommand>): SetTimerEffect {
  return Object.freeze({
    kind: 'setTimer',
    type: 'setTimer',
    key: spec.key,
    action: refOf(spec.invoke),
    input: spec.input,
    ...(spec.at === undefined ? {} : { at: spec.at }),
    ...(spec.after === undefined ? {} : { after: spec.after }),
  });
}
