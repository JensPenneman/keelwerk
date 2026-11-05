import type { Invoker } from '@keelwerk/core';

/**
 * An invoker that forwards to the one `current` returns. The HTTP host needs an invoker before the
 * runtime that owns the real one has started; a call before then is a bug of the caller.
 */
export function lateInvoker(current: () => Invoker | undefined): Invoker {
  const real = (): Invoker => {
    const invoker = current();
    if (invoker === undefined) throw new Error('the runtime has not started yet');
    return invoker;
  };
  return {
    open: (carrier, options) => real().open(carrier, options),
    invoke: (invocation) => real().invoke(invocation),
    subscribe: (invocation, resume) => real().subscribe(invocation, resume),
  };
}
