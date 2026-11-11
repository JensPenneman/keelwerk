import { newUuidV7 } from '../ids/new-uuid-v7.ts';
import type { Carrier } from '../invoker/carrier.ts';
import type { Job } from '../jobs/job.ts';
import { jobOutcomeOfError } from './job-outcome-of-error.ts';
import { prepareActionJob } from './prepare-action-job.ts';
import type { RunJobContext } from './run-job.ts';
import { settleJobAttempt } from './settle-job-attempt.ts';

/**
 * Runs an action job through the invoker (9.5.6, S-122): the carrier holds the job's scope and
 * principal reference, so scope and principal are resolved again and the gate and the item checks
 * run against the current state. The input's secret members are opened first, and the gate judges
 * the transport of the job's own receipt, or an unknown transport when it has none
 * (`prepareActionJob`). A command that succeeds settles the attempt in its own unit. A failure is
 * judged by the error taxonomy: a lost lease completes nothing; a retry or a given-up attempt is
 * completed in one unit of the job's scope, which also fails the job's own `accepted` receipt (and
 * appends its change record) when the job gives up (D5).
 */
export async function runActionJob(job: Job, context: RunJobContext): Promise<void> {
  const { stored } = job;
  if (!('action' in stored.run)) return;
  const { action, commandId } = stored.run;
  const { input, transport } = await prepareActionJob(context.source, stored, stored.run);
  const carrier: Carrier = {
    transport: 'job',
    job: {
      scope: stored.scope,
      namespace: context.source.namespace.id,
      principal: stored.principal,
      transport,
      attempt: stored.attempt,
      ...(stored.causation.eventId === undefined ? {} : { causationId: stored.causation.eventId }),
      worker: context.worker,
      signal: job.signal,
    },
    ...(stored.apiVersion === undefined
      ? {}
      : { headers: { 'keelwerk-version': stored.apiVersion } }),
  };
  const outcome = await context.invoker.invoke({
    action,
    input,
    carrier,
    requestId: newUuidV7(),
    ...(commandId === undefined ? {} : { commandId }),
    prefer: 'sync',
    signal: job.signal,
  });
  if (outcome.ok) return;
  const next = jobOutcomeOfError(outcome.error, stored, context.clock.now(), context.random);
  if (next === undefined) return;
  await settleJobAttempt(context, stored, next);
}
