/** One Standard Schema issue of a `validation` error. */
export interface ErrorIssue {
  readonly path: readonly PropertyKey[];
  readonly message: string;
}
