import { assertNamespaceRoot } from './assert-namespace-root.ts';
import { queuedJobStates } from './queued-job-states.ts';

/**
 * The statements of framework step 0005: a partial index of the jobs that wait to run, by scope
 * and queue, which the queued cap of the commit tail and `JobStore.queued` read (a range scan that
 * stops after the rows it needs). It is built inside the step, so writers of `kw_jobs` wait until
 * the provision commits. Stored format: final once released, changed only by a later framework step.
 */
export function kwJobsQueuedDdl(root: string): readonly string[] {
  const schema = assertNamespaceRoot(root);
  return [
    `create index kw_jobs_queued on "${schema}".kw_jobs (scope_id, queue) where state in ${queuedJobStates}`,
  ];
}
