import type { Prefer } from './prefer.ts';

/** Options of one invocation (section 16.8.4). */
export interface InvokeOptions<P extends Prefer> {
  readonly prefer?: P;
  /** Generated per call when omitted, and reused for retries. */
  readonly commandId?: string;
  /** Resolve after the requested effects settle (section 7.9.5); without a live module this fails with `core.live_unavailable`. */
  readonly waitEffects?: boolean | { readonly timeoutMs: number };
  readonly signal?: AbortSignal;
}
