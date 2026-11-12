/**
 * Why a subject is erased (section 14.7.5), a closed list: a free-text reason would put whatever an
 * operator types, a name or an address, into the ledger, which no erasure can reach.
 */
export const erasureReasons = [
  'subjectRequest',
  'consentWithdrawn',
  'retention',
  'legalObligation',
  'operator',
] as const;

/** One of `erasureReasons`. */
export type ErasureReason = (typeof erasureReasons)[number];
