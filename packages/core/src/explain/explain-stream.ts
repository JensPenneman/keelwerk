import type { Invocation } from '../invoker/invocation.ts';
import type { Invoker } from '../invoker/invoker.ts';
import type { Outcome } from '../invoker/outcome.ts';

/** What the explain stream needs: the process environment, where lines go and a clock. */
export interface ExplainStreamOptions {
  /** Whether the process runs in development: the stream is never on elsewhere (sections 11 and 13.6). */
  readonly development: boolean;
  /** `RuntimeOptions.env`: the stream is on when `KEELWERK_EXPLAIN` is `1`. */
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly write: (line: string) => void;
  readonly clock: { now(): Temporal.Instant };
}

/**
 * The per-invocation explanation of development (section 11): with `KEELWERK_EXPLAIN=1` every
 * invocation writes one line, `<transport> -> <action> <outcome> <n> ms`, where the outcome is
 * `ok` or the error code. Any other value, and any process that is not in development, leaves the invoker as it is.
 */
export function explainStream(inner: Invoker, options: ExplainStreamOptions): Invoker {
  if (!options.development || options.env.KEELWERK_EXPLAIN !== '1') return inner;
  return {
    ...inner,
    invoke: async <I, O>(inv: Invocation<I>): Promise<Outcome<O>> => {
      const started = options.clock.now().epochMilliseconds;
      const outcome = await inner.invoke<I, O>(inv);
      const elapsed = Math.max(0, options.clock.now().epochMilliseconds - started);
      options.write(
        `${inv.carrier.transport} -> ${inv.action} ${outcome.ok ? 'ok' : outcome.error.code} ${elapsed} ms`,
      );
      return outcome;
    },
  };
}
