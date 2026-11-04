import type { Lifecycle } from './lifecycle.ts';

/** Builds the in-flight counter of one host. */
export function createLifecycle(): Lifecycle {
  let active = 0;
  let stopping = false;
  let waiters: (() => void)[] = [];
  const release = () => {
    const pending = waiters;
    waiters = [];
    for (const wake of pending) {
      wake();
    }
  };
  return {
    get stopping() {
      return stopping;
    },
    enter() {
      if (stopping) {
        return false;
      }
      active += 1;
      return true;
    },
    leave() {
      active -= 1;
      if (active === 0) {
        release();
      }
    },
    drain(deadlineMs) {
      stopping = true;
      if (active === 0) {
        return Promise.resolve();
      }
      return new Promise((resolve) => {
        const timer = setTimeout(resolve, Math.max(0, deadlineMs));
        waiters.push(() => {
          clearTimeout(timer);
          resolve();
        });
      });
    },
  };
}
