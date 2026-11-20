import type { FlagRead } from '../events/flag-read.ts';
import type { PrepareRecord } from '../events/prepare-record.ts';

/** What `prepare` produced (phase 2 of 7.9.4). */
export interface PreparedRun {
  /** What `prepare` returned: `ctx.prepared` of `decide`. */
  readonly value: unknown;
  readonly record: PrepareRecord;
  /** The flag answers `prepare` read; they join `meta.flags`. */
  readonly flags: readonly FlagRead[];
}
