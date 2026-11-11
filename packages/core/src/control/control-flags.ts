/** A core.flag row as stored; `targeting` is checked by `compileFlagRow`. */
export interface FlagTargetingRow {
  readonly id: string;
  readonly key: string;
  readonly backendId: string | null;
  readonly version: number;
  readonly targeting: unknown;
  /** The rule set `targeting` replaced, when there is one. */
  readonly previous?: unknown;
}

/** `ControlStore.flags`: the targeting rows of core.flag and their change subscription. */
export interface ControlFlags {
  /** Every live core.flag row, read in one read-only deployment-scope unit, pages of 500 by id; the unit times out after `targetingReadTimeoutMs`. */
  rows(): Promise<readonly FlagTargetingRow[]>;
  /** The live core.flag row of `id`, read in one read-only deployment-scope unit; undefined when there is none. */
  row(id: string): Promise<FlagTargetingRow | undefined>;
  /** Wake-ups of the control namespace's feed, never data; ends when `signal` aborts; rejects when the feed fails. */
  changes(signal: AbortSignal): AsyncIterable<unknown>;
}
