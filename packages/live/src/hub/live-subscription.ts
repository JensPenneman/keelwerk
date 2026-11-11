import type { InvocationSession, KeelwerkError } from '@keelwerk/core';

/**
 * A live subscription as the revalidation of 16.3.4 sees it. `renew` swaps in a session opened again;
 * when the plan it gives differs, the stream sends `reset` `resync` without a state and ends. `fail`
 * ends the stream: `next()` throws `error`.
 */
export interface LiveSubscription {
  readonly session: InvocationSession;
  renew(session: InvocationSession): Promise<void>;
  fail(error: KeelwerkError): void;
}
