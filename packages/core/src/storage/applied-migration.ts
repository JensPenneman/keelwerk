/** One row of `kw_migrations` (section 14.6.3). */
export interface AppliedMigration {
  readonly track: string;
  readonly id: string;
  /** SHA-256 of the canonical neutral steps; a changed applied file is drift. */
  readonly checksum: string;
  readonly appliedAt: Temporal.Instant;
  readonly stepsApplied: number;
}
