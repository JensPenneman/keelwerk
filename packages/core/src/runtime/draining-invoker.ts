import { errors } from '../errors/errors.ts';
import type { Invocation } from '../invoker/invocation.ts';
import type { Invoker } from '../invoker/invoker.ts';
import type { Outcome } from '../invoker/outcome.ts';

/** An invoker that counts its running invocations and, once draining, refuses new ones (the `stop` phase, section 21.6). */
export interface DrainingInvoker {
  readonly invoker: Invoker;
  /** Refuses new invocations from now on. */
  drain(): void;
  /** Resolves when no invocation is running. */
  idle(): Promise<void>;
}

/** Wraps `inner` so `stop` can wait for the invocations in flight. */
export function drainingInvoker(inner: Invoker): DrainingInvoker {
  let draining = false;
  const running = new Set<Promise<unknown>>();
  return {
    invoker: {
      ...inner,
      invoke: <I, O>(inv: Invocation<I>): Promise<Outcome<O>> => {
        if (draining) {
          return Promise.resolve({
            ok: false,
            error: errors.unavailable('The process is stopping and takes no new invocations.'),
          });
        }
        const call = inner.invoke<I, O>(inv);
        running.add(call);
        const done = (): void => {
          running.delete(call);
        };
        call.then(done, done);
        return call;
      },
    },
    drain: () => {
      draining = true;
    },
    idle: async () => {
      while (running.size > 0) await Promise.allSettled([...running]);
    },
  };
}
