import type { Prefer } from './prefer.ts';

/** Options of one invocation (section 16.8.4). */
export interface InvokeOptions<P extends Prefer> {
  readonly prefer?: P;
  /** Generated per call when omitted, and reused for retries. */
  readonly commandId?: string;
  /**
   * Resolve after the effects the answer lists have settled (section 7.9.5), watched on the live carrier;
   * an accepted (asynchronous) answer lists none, so it resolves at once. A server without the live module
   * fails after the command committed, with `core.live_unavailable`. A timeout resolves with the effects as they stand.
   */
  readonly waitEffects?: boolean | { readonly timeoutMs: number };
  readonly signal?: AbortSignal;
}
