/** The ISO durations the buffers keep: each before now, the tickets after their `expiresAt`. */
export interface RetainRules {
  readonly transientRecords: string;
  readonly jobHistory: string;
  readonly streamTickets: string;
}
