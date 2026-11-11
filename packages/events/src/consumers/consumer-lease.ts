/** The lease of one consumer in one namespace (D1), as one runner holds it. */
export interface ConsumerLease {
  /** True when held afterwards; schedules the next attempt or renewal a third of the lease later. */
  acquire(): Promise<boolean>;
  /** False when lost or expired; the holder then stops before its next batch. */
  renew(): Promise<boolean>;
  /** `renewLease` with ttl 0; logs and swallows errors. */
  release(): Promise<void>;
  holds(): boolean;
  /** When the next renewal, or the next attempt of a standby, is due on the runtime clock. */
  dueAt(): Temporal.Instant;
}
