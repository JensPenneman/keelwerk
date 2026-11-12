/** One deprecation a response or a live connection announces (18.5, 15.4.6 `notice`, GraphQL `extensions.keelwerk.deprecations`). */
export interface DeprecationNotice {
  readonly kind: 'deprecation';
  readonly apiVersion?: string;
  /**
   * The ref of a deprecated action as the API version of the request that opened the stream or the
   * socket names it (everything a stream delivers is in that version, 18.3), so a renamed action is
   * announced under its older name to a caller of the older version.
   */
  readonly action?: string;
  /** The date the deprecation begins: `YYYY-MM-DD`, or the instant an action declared. Absent for an action deprecated without a date, which is in force from its declaration. */
  readonly at?: string;
  /** The declared sunset: `YYYY-MM-DD`, or the instant an action declared. */
  readonly sunset?: string;
}
