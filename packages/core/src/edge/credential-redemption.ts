import type { PrincipalRef } from '../principals/principal-ref.ts';

/** A single-use credential a resolver accepted (a stream ticket, S-161): the kernel spends it, then resolves the principal it stands for. */
export interface CredentialRedemption {
  /** An entity of the answering module that declares `usedAt: field.instant().optional()`: 'live.streamTicket'. */
  readonly entity: string;
  readonly id: string;
  /** The row version the resolver read; the spend is a conditional update at it. */
  readonly version: number;
  /** Re-resolved through its resolver's `fromRef` (S-122), at open and at every revalidation. */
  readonly ref: PrincipalRef;
}
