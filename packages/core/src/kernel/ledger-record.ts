import type { StreamRef } from '../events/stream-ref.ts';
import type { ErasureRecord } from '../ledger/erasure-record.ts';
import type { KeyTombstoneRecord } from '../ledger/key-tombstone-record.ts';

/**
 * One line of the ledger file: RFC 8785 canonical JSON, discriminated by `type` (S-34). M1 writes
 * `anchor`; `erasure` and `keyTombstone` join in M2, and readers skip types they do not know.
 */
export type LedgerRecord =
  /** A scope's chain head (section 15.1.8). */
  | {
      readonly type: 'anchor';
      readonly scopeId: string;
      /** The scope's latest position, as a decimal string. */
      readonly position: string;
      /** Hash of the scope's latest event. */
      readonly hash: string;
      /** The stream that held the head at that moment. */
      readonly stream: StreamRef;
      /** ISO 8601 instant. */
      readonly recordedAt: string;
      readonly writer: { readonly process: string; readonly build: string };
    }
  | ErasureRecord
  | KeyTombstoneRecord;
