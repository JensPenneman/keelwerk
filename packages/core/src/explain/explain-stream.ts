import { KeelwerkError } from '../errors/keelwerk-error.ts';
import type { Invocation } from '../invoker/invocation.ts';
import type { Invoker } from '../invoker/invoker.ts';
import type { LiveFrame } from '../invoker/live-frame.ts';
import type { Outcome } from '../invoker/outcome.ts';
import type { ExplainDecisions } from './explain-decisions.ts';
import { explainStreamOn } from './explain-stream-on.ts';

/** What the explain stream needs: the process environment, where lines go and a clock. */
export interface ExplainStreamOptions {
  /** Whether the process runs in development: the stream is never on elsewhere (sections 11 and 13.6). */
  readonly development: boolean;
  /** `RuntimeOptions.env`: the stream is on when `KEELWERK_EXPLAIN` is `1`. */
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly write: (line: string) => void;
  readonly clock: { now(): Temporal.Instant };
  /** The invoker's decisions (`explainDecisions`): the line adds their matched rules and failed stage. */
  readonly decisions?: ExplainDecisions;
}

/**
 * The per-invocation explanation of development (section 11): with `KEELWERK_EXPLAIN=1` every
 * invocation writes one line, `<transport> -> <action> <outcome> <n> ms rules=<ids|->`, where the
 * outcome is `ok` or the error code, the rules are those `authorize` matched (`-` when the invoker
 * reported none), and a failure adds `stage=<stage>` when the invoker reported where it stopped.
 * A subscription writes one line, with `kind=subscribe`, when its first `next()` settles. Any
 * other value, and any process that is not in development, leaves the invoker as it is.
 */
export function explainStream(inner: Invoker, options: ExplainStreamOptions): Invoker {
  if (!explainStreamOn(options)) return inner;
  const lineOf = (
    inv: Invocation<unknown>,
    code: string,
    elapsed: number,
    kind: 'invoke' | 'subscribe',
  ): string => {
    const decision = options.decisions?.take(inv.requestId);
    const ids = decision?.rules.map((rule) => rule.id).join(',');
    const rules = ids === undefined || ids === '' ? '-' : ids;
    const stage = code !== 'ok' && decision !== undefined ? ` stage=${decision.stage}` : '';
    return `${inv.carrier.transport} -> ${inv.action} ${code} ${elapsed} ms rules=${rules}${stage}${kind === 'subscribe' ? ' kind=subscribe' : ''}`;
  };
  const since = (started: number): number =>
    Math.max(0, options.clock.now().epochMilliseconds - started);
  return {
    ...inner,
    invoke: async <I, O>(inv: Invocation<I>): Promise<Outcome<O>> => {
      const started = options.clock.now().epochMilliseconds;
      const outcome = await inner.invoke<I, O>(inv);
      options.write(lineOf(inv, outcome.ok ? 'ok' : outcome.error.code, since(started), 'invoke'));
      return outcome;
    },
    subscribe: <I, E>(inv: Invocation<I>): AsyncIterable<LiveFrame<E>> => {
      const started = options.clock.now().epochMilliseconds;
      const source = inner.subscribe<I, E>(inv);
      return {
        [Symbol.asyncIterator]: () => {
          const iterator = source[Symbol.asyncIterator]();
          let written = false;
          const write = (code: string): void => {
            if (written) return;
            written = true;
            options.write(lineOf(inv, code, since(started), 'subscribe'));
          };
          return {
            next: async (...args) => {
              try {
                const step = await iterator.next(...args);
                write('ok');
                return step;
              } catch (error) {
                write(error instanceof KeelwerkError ? error.code : 'core.internal');
                throw error;
              }
            },
            return: async (value?: unknown) =>
              (await iterator.return?.(value)) ?? { done: true, value: undefined },
          };
        },
      };
    },
  };
}
