/** A group row as the take reads it under the row's lock (9.5.2). */
export interface SqlGroupState {
  readonly id: string;
  /** Null for a group that spans the namespace's scopes. */
  readonly scopeId: string | null;
  readonly concurrency: number | null;
  readonly running: number;
  readonly rate: { readonly count: number; readonly periodMs: number } | null;
  readonly tokens: number;
  readonly refilledAt: Temporal.Instant | null;
  readonly blockedUntil: Temporal.Instant | null;
}
