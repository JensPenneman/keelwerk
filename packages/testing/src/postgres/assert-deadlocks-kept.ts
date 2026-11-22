/**
 * Fails when the deadlock counter read after a restart is lower than before it: the restart reset
 * the statistics the deadlock rule reads, so a deadlock before it could no longer be seen.
 */
export function assertDeadlocksKept(before: number, after: number): void {
  if (after < before) {
    throw new Error(
      `The deadlock counter fell from ${before} to ${after} across the restart of the server: the rule of the deadlock check cannot see deadlocks from before it.`,
    );
  }
}
