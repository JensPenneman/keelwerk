/** A promise that rejects with the signal's reason when it aborts, and a way to stop listening. */
export function abortRace(signal: AbortSignal): {
  readonly promise: Promise<never>;
  stop(): void;
} {
  let stop = (): void => undefined;
  const promise = new Promise<never>((_resolve, reject) => {
    const onAbort = (): void => {
      reject(signal.reason);
    };
    if (signal.aborted) onAbort();
    signal.addEventListener('abort', onAbort, { once: true });
    stop = () => {
      signal.removeEventListener('abort', onAbort);
    };
  });
  // Nobody awaits it when the executor wins the race.
  promise.catch(() => undefined);
  return { promise, stop };
}
