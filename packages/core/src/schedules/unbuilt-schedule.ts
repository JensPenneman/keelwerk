/** The ticks of one schedule, in one pass, whose input could not be built: how many, and the first of them. */
export interface UnbuiltSchedule {
  count: number;
  /** The scope id of the first tick that failed. */
  readonly scope: string;
  readonly code: string | undefined;
  readonly cause: unknown;
}
