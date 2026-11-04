/** The outcome of taking from a rate bucket (S-36). */
export interface BucketTake {
  readonly ok: boolean;
  /** Seconds until a token is available again; set when `ok` is false. */
  readonly retryAfter?: number;
}
