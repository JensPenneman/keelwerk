/** A change of one usage counter at the commit tail; `limit` null counts without refusing. */
export interface UsageCharge {
  readonly dimension: string;
  readonly delta: bigint;
  readonly limit: bigint | null;
}
