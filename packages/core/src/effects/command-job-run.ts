import type { JobRun } from '../jobs/job-run.ts';

/**
 * What a command job runs: the action and its input, and the command id it runs under, which the
 * receipt of an accepted command or the `commandId` of an `enqueue` names.
 */
export function commandJobRun(action: string, input: unknown, commandId: string): JobRun {
  return { action, input, commandId };
}
