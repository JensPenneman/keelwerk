import type { DeprecationNotice, InvokeResponse, LiveFrame } from '@keelwerk/core';

/** What one call may set (section 16.9.4). */
export interface CallOptions {
  /** Reused for every retry of this call, so retrying never applies a command twice. */
  readonly commandId?: string;
  readonly prefer?: 'sync' | 'async';
  readonly signal?: AbortSignal;
  readonly traceparent?: string;
  /** Called once when the answer announces a deprecation (18.5). */
  readonly onDeprecation?: (notice: DeprecationNotice) => void;
}

/** The app's client keyed by runtime strings: the CLI knows no action at compile time. */
export interface UntypedClient {
  invoke(action: string, input: unknown, options?: CallOptions): Promise<InvokeResponse>;
  /**
   * A subscription (16.9.5): the frames of the action in their wire form (an item is its wire value,
   * its `state` the stream token), resumed from the last token after a dropped connection. A refusal of
   * the setup, `error` events and `version_retired` throw a `CliFailure`.
   */
  subscribe(
    action: string,
    input: unknown,
    options?: {
      readonly after?: string;
      readonly signal?: AbortSignal;
      readonly onDeprecation?: (notice: DeprecationNotice) => void;
    },
  ): AsyncIterable<LiveFrame<unknown>>;
}
