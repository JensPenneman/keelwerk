import type { Prefer } from './prefer.ts';

/** Options of one invocation (section 16.8.4). */
export interface InvokeOptions<P extends Prefer> {
  readonly prefer?: P;
  /** Generated per call when omitted, and reused for retries. */
  readonly commandId?: string;
  /**
   * Resolve after the effects the answer lists have settled (section 7.9.5), watched on the live carrier;
   * an accepted (asynchronous) answer lists none, so it resolves at once. A surface without the live module
   * fails with `core.live_unavailable` before anything is sent. A wait that fails after the command committed
   * is an error that is not retryable (`attempt` also returns its `commandId` and `effects`):
   * send it again only under that command id, or wait for its effects with waitForEffects.
   * So is a wait that ends before every effect settled (`timeoutMs` reached, or the watch closed):
   * `unavailable`, `client.effects_unsettled` (never `core.timeout`, which means rolled back and safe to
   * send again; a `core.timeout` of the watch is reported as this code too). An abort is thrown as it
   * is, also after the command committed, so a caller that may abort passes its own `commandId`.
   */
  readonly waitEffects?: boolean | { readonly timeoutMs: number };
  readonly signal?: AbortSignal;
}
