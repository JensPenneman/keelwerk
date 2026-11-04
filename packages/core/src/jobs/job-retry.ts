/** Mechanical retries by the error taxonomy (section 9.5.4). */
export interface JobRetry {
  readonly limit?: number;
  readonly delays: 'exponential' | readonly string[];
  readonly maxDelay?: string;
  readonly giveUpAfter?: string;
}
