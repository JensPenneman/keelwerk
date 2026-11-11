import type { DecisionHook, InvocationDecision } from '../invoker/decision-hook.ts';
import { explainStreamOn } from './explain-stream-on.ts';

const untakenLimit = 256;

/** The invoker's decisions for the explain stream, by request id, until the stream's line takes them. */
export interface ExplainDecisions {
  /** `InvokerOptions.onDecision`: keeps the newest decision per request id, at most 256 untaken (the oldest is dropped first). */
  readonly onDecision: DecisionHook;
  /** The decision for the request id, removed as it is read; undefined when the invoker reported none. */
  take(requestId: string): InvocationDecision | undefined;
}

/** The decision store of the explain stream; undefined where `explainStreamOn` is false, so the invoker gets no hook there. */
export function explainDecisions(options: {
  readonly development: boolean;
  readonly env: Readonly<Record<string, string | undefined>>;
}): ExplainDecisions | undefined {
  if (!explainStreamOn(options)) return undefined;
  const kept = new Map<string, InvocationDecision>();
  return {
    onDecision: (decision) => {
      // Deleting first moves a repeated request id to the newest place.
      kept.delete(decision.requestId);
      kept.set(decision.requestId, decision);
      if (kept.size > untakenLimit) {
        const oldest = kept.keys().next();
        if (!oldest.done) kept.delete(oldest.value);
      }
    },
    take: (requestId) => {
      const found = kept.get(requestId);
      kept.delete(requestId);
      return found;
    },
  };
}
