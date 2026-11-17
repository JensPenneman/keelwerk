/**
 * A controller of its own that also aborts when `signal` does, and that lets go of `signal` once it
 * has aborted. A request's work stops with its own controller, so nothing outlives its answer,
 * whether or not the connection's signal ever fires.
 */
export function linkedAbort(signal: AbortSignal): AbortController {
  const controller = new AbortController();
  if (signal.aborted) {
    controller.abort(signal.reason);
    return controller;
  }
  const forward = (): void => controller.abort(signal.reason);
  signal.addEventListener('abort', forward, { once: true });
  controller.signal.addEventListener('abort', () => signal.removeEventListener('abort', forward), {
    once: true,
  });
  return controller;
}
