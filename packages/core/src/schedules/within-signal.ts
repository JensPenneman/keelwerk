/**
 * `work`'s answer, or the signal's reason as soon as it aborts, whichever comes first: the caller
 * stops waiting for a unit that is too slow, and the unit, whose own signal is the same, commits
 * nothing when it ends.
 */
export function withinSignal<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) {
      work.catch(() => undefined);
      reject(signal.reason);
      return;
    }
    const onAbort = (): void => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}
