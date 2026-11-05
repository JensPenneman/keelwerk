/** What the anchor writer knows of one ledger sink: how many appends it refused and the last refusal. */
export interface AnchorSinkStatus {
  readonly sink: string;
  /** Appends the sink refused: the sink's own count when it keeps one, else the writer's. */
  readonly refusedAppends: number;
  readonly lastFailure?: { readonly at: string; readonly message: string };
}
