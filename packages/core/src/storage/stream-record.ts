/** One record of a declared stream (section 14.3.2). */
export interface StreamRecord {
  readonly seq: bigint;
  readonly at: Temporal.Instant;
  readonly data: unknown;
}
