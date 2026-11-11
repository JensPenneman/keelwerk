interface Waiter {
  readonly scope: string;
  readonly start: () => void;
  readonly cancel: () => void;
}

/** Bounds the read-only units the starts of subscriptions hold at once. */
export interface StartLimiter {
  /**
   * Runs `work` once a slot of `scope` and of the hub is free. A waiter whose `signal` aborts leaves
   * the queue and gets `undefined`; `work` is then never run.
   */
  run<T>(scope: string, signal: AbortSignal, work: () => Promise<T>): Promise<T | undefined>;
}

/** A limiter with `perScope` slots for each scope and `perHub` in all; waiters are served in order. */
export function createStartLimiter(perScope: number, perHub: number): StartLimiter {
  const running = new Map<string, number>();
  let total = 0;
  const queue: Waiter[] = [];

  const free = (scope: string): boolean => total < perHub && (running.get(scope) ?? 0) < perScope;
  const take = (scope: string): void => {
    total += 1;
    running.set(scope, (running.get(scope) ?? 0) + 1);
  };
  const release = (scope: string): void => {
    total -= 1;
    const left = (running.get(scope) ?? 1) - 1;
    if (left === 0) running.delete(scope);
    else running.set(scope, left);
    // The first waiter that can run goes; one that cannot (its scope is full) does not block the others.
    for (let at = 0; at < queue.length; at += 1) {
      const waiter = queue[at];
      if (waiter !== undefined && free(waiter.scope)) {
        queue.splice(at, 1);
        take(waiter.scope);
        waiter.start();
        return;
      }
    }
  };

  return {
    run: async (scope, signal, work) => {
      if (signal.aborted) return undefined;
      if (!free(scope)) {
        const admitted = await new Promise<boolean>((resolve) => {
          const waiter: Waiter = {
            scope,
            start: () => {
              signal.removeEventListener('abort', waiter.cancel);
              resolve(true);
            },
            cancel: () => {
              const at = queue.indexOf(waiter);
              if (at >= 0) queue.splice(at, 1);
              resolve(false);
            },
          };
          signal.addEventListener('abort', waiter.cancel, { once: true });
          queue.push(waiter);
        });
        if (!admitted) return undefined;
      } else {
        take(scope);
      }
      try {
        return await work();
      } finally {
        release(scope);
      }
    },
  };
}
