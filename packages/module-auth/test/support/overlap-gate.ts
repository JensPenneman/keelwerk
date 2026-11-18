import type { DataAdapter, JobOutcome, Unit } from '@keelwerk/core';

/** The attempts of a runtime that end in a gate, and a way to wait until a number of them arrived. */
export interface OverlapGate {
  /** Resolves once `count` successful attempts wait in the gate; rejects after `timeoutMs`. */
  arrived(count: number, timeoutMs?: number): Promise<void>;
  /** Lets every attempt that waits go on to commit, and every later one pass. */
  open(): void;
}

/**
 * Holds a job attempt that succeeded, before its unit commits, until `open` is called, so that
 * a test can have two attempts of one queue running at the same moment. A store that runs the
 * units of a namespace one after the other (memory, PGlite) would wait for ever: use it on a
 * store with one connection for each unit (PostgreSQL). The adapter object the kernel holds is
 * changed in place and the gate starts at once.
 */
export function overlapGate(adapter: DataAdapter): OverlapGate {
  let waiting = 0;
  let opened = false;
  const release: (() => void)[] = [];
  const watchers: { count: number; resolve: () => void }[] = [];
  const hold = (): Promise<void> =>
    new Promise((resolve) => {
      waiting += 1;
      release.push(resolve);
      for (const watcher of watchers.filter((each) => each.count <= waiting)) watcher.resolve();
    });
  const target = adapter as { unit: DataAdapter['unit'] };
  const inner = target.unit.bind(adapter);
  target.unit = (namespace, scope, fn, options) =>
    inner(
      namespace,
      scope,
      (unit) => {
        const jobs = new Proxy(unit.jobs, {
          get(store, property) {
            const value: unknown = Reflect.get(store, property, store);
            if (property !== 'complete' || typeof value !== 'function') {
              return typeof value === 'function' ? value.bind(store) : value;
            }
            return async (attempt: never, worker: string, outcome: JobOutcome) => {
              if (!opened && outcome.kind === 'succeeded') await hold();
              return unit.jobs.complete(attempt, worker, outcome);
            };
          },
        });
        const gated = new Proxy(unit, {
          get(inside, property) {
            if (property === 'jobs') return jobs;
            const value: unknown = Reflect.get(inside, property, inside);
            return typeof value === 'function' ? value.bind(inside) : value;
          },
        });
        return fn(gated as Unit);
      },
      options,
    );
  return {
    arrived: (count, timeoutMs = 20_000) =>
      waiting >= count
        ? Promise.resolve()
        : new Promise((resolve, reject) => {
            const timer = setTimeout(
              () => reject(new Error(`only ${waiting} of ${count} attempts reached the gate`)),
              timeoutMs,
            );
            watchers.push({
              count,
              resolve: () => {
                clearTimeout(timer);
                resolve();
              },
            });
          }),
    open: () => {
      opened = true;
      for (const resolve of release.splice(0)) resolve();
    },
  };
}
