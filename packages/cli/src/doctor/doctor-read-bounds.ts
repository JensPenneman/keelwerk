/**
 * What bounds the reads doctor makes of the control store. `unitTimeoutMs` is the time limit of
 * each statement of a unit (a statement timeout on PostgreSQL); a read that pages is not bounded
 * by it as a whole. `pageSize` and `pageBudget` bound the reads that page: a fact that needs more
 * pages than the budget allows is absent. `deadlineMs` bounds the wait of doctor for one fact, and
 * for the read of the recorded deployment id, whatever the connection does.
 */
export const doctorReadBounds = {
  unitTimeoutMs: 5000,
  pageSize: 500,
  pageBudget: 200,
  deadlineMs: 30_000,
} as const;
