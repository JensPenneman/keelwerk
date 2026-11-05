/** The applied and pending migration files of one namespace. */
export interface NamespaceStatus {
  readonly placement: string;
  readonly app: string;
  /** `track id`, in the order the history recorded them. */
  readonly applied: readonly string[];
  /** Committed files the history lacks, in run order. */
  readonly pending: readonly string[];
}
