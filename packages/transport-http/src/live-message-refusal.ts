import type { KeelwerkError } from '@keelwerk/core';

/** A message whose frame is sound but whose members are not: answered under its id, the socket stays open. */
export interface LiveMessageRefusal {
  readonly type: 'refused';
  readonly id?: string;
  /** A subscribe and a presence message are answered with an `error`, an invoke with a `result`. */
  readonly answer: 'error' | 'result';
  readonly error: KeelwerkError;
}
