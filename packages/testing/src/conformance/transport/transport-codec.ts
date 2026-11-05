import type { Call } from './call.ts';
import type { Sent } from './sent.ts';
import type { TransportTarget } from './transport-target.ts';

/**
 * How one transport carries a call (S-52): turns the abstract call into the transport's request,
 * sends it through the target's `fetch` and decodes the answer into the outcome both transports
 * must agree on. The members after `send` are the facts that differ between transports: each
 * codec reads its own place for them and says what the suite must find there. A scenario about a
 * fact a transport has no place for (a replay marker, a receipt `Location`, a stream) runs only
 * for the codecs that have one and is skipped for the others (`test.skipIf`), so the count of
 * skipped tests shows it and nothing passes without asserting.
 */
export interface TransportCodec {
  readonly name: string;
  /** The path commands are sent to when it does not depend on the action: the preflight target. */
  readonly endpoint: string;
  send(target: TransportTarget, call: Call): Promise<Sent>;
  /** Where the answer to an accepted command says its stored receipt is (REST: `Location`), or null when the transport names no location. */
  receiptLocationOf(sent: Sent): string | null;
  /** What `receiptLocationOf` must answer for the receipt `receiptId`; null when the transport names no location. */
  expectedReceiptLocation(receiptId: string): string | null;
  /** The version of the row a write answers, as the transport reports it (REST: the entity tag; protocol: the row). */
  rowVersionOf(sent: Sent): number | null;
  /** The command id the answer reports back, or null. */
  commandIdOf(sent: Sent): string | null;
  /** Whether the answer reports a command id the client chose (the protocol reports generated ids only). */
  readonly reportsChosenCommandId: boolean;
  /** The path of the server-sent event stream (`GET`, `action` and `input` in the query), or undefined when the transport has none. */
  readonly subscribePath?: string;
  /** Whether the answer marks an idempotent replay (only meaningful when `marksReplays`). */
  isReplay(sent: Sent): boolean;
  /** Whether this transport marks replays at all (REST: `Idempotent-Replayed`). */
  readonly marksReplays: boolean;
  /**
   * Whether the transport module has a `cors` setting that allows origins beyond the tenant's own
   * domains (REST has one; the invocation protocol has none, so a configured origin is a stranger to it).
   */
  readonly configurableCors: boolean;
}
