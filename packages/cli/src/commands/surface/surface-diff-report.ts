import type { SurfaceDiffEntry } from './surface-diff-entry.ts';

/** What `surface diff` found: every classified change, and the lines that fail the run. */
export interface SurfaceDiffReport {
  readonly changes: readonly SurfaceDiffEntry[];
  /** Breaking changes, removed versions and edited ledger entries. */
  readonly failures: readonly string[];
  /** Dangerous changes and apps the base does not have. */
  readonly notes: readonly string[];
}
