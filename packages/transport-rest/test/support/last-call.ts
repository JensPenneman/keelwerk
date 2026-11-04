import type { Invocation } from '@keelwerk/core';

export function lastCall(calls: Invocation<unknown>[]): Invocation<unknown> {
  const last = calls.at(-1);
  if (last === undefined) {
    throw new Error('the invoker was not called');
  }
  return last;
}
