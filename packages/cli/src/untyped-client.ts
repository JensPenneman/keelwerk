import type { InvokeResponse } from '@keelwerk/core';

/** What one call may set (section 16.9.4). */
export interface CallOptions {
  /** Reused for every retry of this call, so retrying never applies a command twice. */
  readonly commandId?: string;
  readonly prefer?: 'sync' | 'async';
  readonly signal?: AbortSignal;
  readonly traceparent?: string;
}

/** The app's client keyed by runtime strings: the CLI knows no action at compile time. */
export interface UntypedClient {
  invoke(action: string, input: unknown, options?: CallOptions): Promise<InvokeResponse>;
}
