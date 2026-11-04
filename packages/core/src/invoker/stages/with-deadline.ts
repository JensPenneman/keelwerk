import { KeelwerkError } from '../../errors/keelwerk-error.ts';

/**
 * Runs `run` against a deadline and aborts the signal `run` receives when it passes. A query
 * stops waiting at once and rejects with `unavailable` `core.timeout` (section 16.4.11).
 * `command: true` waits for `run` instead: a command that committed before it saw the abort
 * answers its result, and one that rolled back on the abort is reported as `core.timeout`.
 * `clientSignal` is the caller's: pass it for queries and subscriptions, which a disconnect
 * aborts, never for a command, which completes and records its outcome.
 */
export function withDeadline<T>(
  run: (signal: AbortSignal) => Promise<T>,
  options: {
    readonly timeoutMs?: number;
    readonly clientSignal?: AbortSignal;
    readonly command?: boolean;
  },
): Promise<T> {
  const controller = new AbortController();
  const { clientSignal, timeoutMs } = options;
  const timeout = (): KeelwerkError =>
    new KeelwerkError({
      kind: 'unavailable',
      code: 'core.timeout',
      message: 'The action exceeded its timeout.',
    });
  return new Promise<T>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cancelled = (): void => {
      controller.abort();
      reject(
        new KeelwerkError({
          kind: 'unavailable',
          code: 'core.unavailable',
          message: 'The request was cancelled.',
        }),
      );
    };
    const settle = (): void => {
      if (timer !== undefined) clearTimeout(timer);
      clientSignal?.removeEventListener('abort', cancelled);
    };
    if (clientSignal?.aborted === true) {
      cancelled();
      return;
    }
    clientSignal?.addEventListener('abort', cancelled, { once: true });
    if (timeoutMs !== undefined) {
      timer = setTimeout(() => {
        controller.abort();
        if (options.command !== true) reject(timeout());
      }, timeoutMs);
    }
    run(controller.signal)
      .then(resolve, (error: unknown) => {
        reject(options.command === true && controller.signal.aborted ? timeout() : error);
      })
      .finally(settle);
  });
}
