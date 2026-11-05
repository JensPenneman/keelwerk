/** What a data command found or did in one namespace: a placement's namespace of an app. */
export interface NamespaceOutcome {
  readonly placement: string;
  readonly app: string;
  /** Applied by this run, `track id`. */
  readonly applied: readonly string[];
  /** Left for `--contract` or for a gate. */
  readonly deferred: readonly string[];
  readonly warnings: readonly string[];
}
