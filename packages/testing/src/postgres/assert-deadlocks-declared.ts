/**
 * Fails unless the PostgreSQL deadlock counter moved by exactly the deadlocks the test file declared
 * (`declareDeadlocks`): a deadlock that PostgreSQL ends and a unit survives by a retry is a defect to
 * remove, and a declaration with no deadlock behind it is a case that no longer proves what it says.
 */
export function assertDeadlocksDeclared(moved: number, declared: number): void {
  if (moved !== declared) {
    throw new Error(
      `The test file moved the PostgreSQL deadlock counter by ${moved} and declared ${declared}. ` +
        'A deadlock that PostgreSQL ends and a unit survives by a retry is a defect to remove; a case that provokes deadlocks on purpose calls declareDeadlocks(count) with how many it provokes.',
    );
  }
}
