import { errors } from '../errors/errors.ts';
import type { Invocation } from '../invoker/invocation.ts';
import type { Invoker } from '../invoker/invoker.ts';
import type { Outcome } from '../invoker/outcome.ts';
import { gatedSubscribe } from './gated-subscribe.ts';
import type { ServiceGate } from './service-gate.ts';

/** An invoker that counts its running invocations and, once draining, refuses new ones (the `stop` phase, section 21.6). */
export interface DrainingInvoker {
  readonly invoker: Invoker;
  /** Refuses new invocations from now on. */
  drain(): void;
  /** Resolves when no invocation is running. */
  idle(): Promise<void>;
}

/**
 * Wraps `inner` so `stop` can wait for the invocations in flight. With a `gate`, once it closed (a
 * restore found under the running process) an invocation and `open` are refused with
 * `core.unavailable`, a new subscription throws it and a running one ends with it (`gatedSubscribe`).
 */
export function drainingInvoker(inner: Invoker, gate?: ServiceGate): DrainingInvoker {
  let draining = false;
  const running = new Set<Promise<unknown>>();
  const subscribe: Invoker['subscribe'] = (inv, resume) => inner.subscribe(inv, resume);
  const gated = gate === undefined ? subscribe : gatedSubscribe(subscribe, gate);
  return {
    invoker: {
      open: (carrier, options) =>
        gate?.closed === true
          ? Promise.resolve({
              ok: false,
              error: errors.unavailable('The process is out of service after a restore.'),
            })
          : inner.open(carrier, options),
      subscribe: gated,
      invoke: <I, O>(inv: Invocation<I>): Promise<Outcome<O>> => {
        if (draining) {
          return Promise.resolve({
            ok: false,
            error: errors.unavailable('The process is stopping and takes no new invocations.'),
          });
        }
        if (gate?.closed === true) {
          return Promise.resolve({
            ok: false,
            error: errors.unavailable('The process is out of service after a restore.'),
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
