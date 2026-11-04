import type { PrincipalRef } from '../principals/principal-ref.ts';
import type { ReceiptOutcome } from './receipt-outcome.ts';

/** The `core.commandReceipt` row (section 15.1.7); only the kernel writes it. */
export interface Receipt {
  readonly commandId: string;
  readonly action: string;
  /** Digest of the input and the API version. */
  readonly fingerprint: string;
  readonly principal: PrincipalRef | null;
  readonly status: 'pending' | 'accepted' | 'completed' | 'failed';
  readonly outcome: ReceiptOutcome | null;
  readonly apiVersion: string;
  readonly request: {
    readonly transport: string;
    readonly remoteAddress: string | null;
    readonly userAgent: string | null;
  };
  readonly clientId: string | null;
  readonly clientSeq: number | null;
  readonly expiresAt: Temporal.Instant;
}
