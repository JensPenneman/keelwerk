import { timerQueue } from '../effects/timer-queue.ts';
import { declaredErrorCodesOf } from '../executors/declared-error-codes-of.ts';
import { newUuidV7 } from '../ids/new-uuid-v7.ts';
import { refuseRequest } from '../interpreter/refuse-request.ts';
import type { Carrier } from '../invoker/carrier.ts';
import type { Job } from '../jobs/job.ts';
import { reactionJobError } from '../reactions/reaction-job-error.ts';
import { reactionQueue } from '../reactions/reaction-queue.ts';
import { scheduleQueue } from '../schedules/schedule-queue.ts';
import { isCrossScopeJob } from './is-cross-scope-job.ts';
import { jobOutcomeOfError } from './job-outcome-of-error.ts';
import { kernelJobError } from './kernel-job-error.ts';
import { prepareActionJob } from './prepare-action-job.ts';
import type { RunJobContext } from './run-job.ts';
import { settleJobAttempt } from './settle-job-attempt.ts';

/**
 * Runs an action job through the invoker (9.5.6, S-122): the carrier holds the job's scope and
 * principal reference, so scope and principal are resolved again and the gate and the item checks
 * run against the current state. The input's secret members are opened first, and the gate judges
 * the transport of the job's own receipt, or an unknown transport when it has none
 * (`prepareActionJob`). A command that succeeds completes the attempt in its own unit; only the
 * command of a tenant's job that runs in that tenant's backend unit (`isCrossScopeJob`) cannot, and
 * the attempt is then settled `succeeded` here, in a unit of the job's own scope
 * (`settleJobAttempt`). A failure is
 * judged by the error taxonomy: a lost lease completes nothing; a retry or a given-up attempt is
 * completed in one unit of the job's scope, which also fails the job's own `accepted` receipt (and
 * appends its change record) when the job gives up (D5).
 */
export async function runActionJob(job: Job, context: RunJobContext): Promise<void> {
  const { stored } = job;
  if (!('action' in stored.run)) return;
  const { action, commandId } = stored.run;
  // A reaction job's input is the event reference the dispatcher stored: it holds no secret member and no receipt of
  // its own, so there is nothing to prepare, and the gate judges an unknown transport.
  const reaction = stored.queue === reactionQueue;
  const entry = context.source.registry.actions.get(action);
  const crossesScopes =
    !reaction && entry !== undefined && isCrossScopeJob(stored.scope, entry.scope);
  // A job that crosses scopes is held once by the receipt of its command id in the backend scope: one
  // without a command id would run again with a new id on every attempt, so it fails and does not run.
  if (crossesScopes && commandId === undefined) {
    const refused = refuseRequest(
      `the job of "${action}"`,
      'a job that crosses scopes carries the command id its receipt is kept under',
    );
    const next = jobOutcomeOfError(refused, stored, context.clock.now(), context.random);
    if (next !== undefined) await settleJobAttempt(context, stored, next);
    return;
  }
  const { input, transport } = reaction
    ? { input: stored.run.input, transport: null }
    : await prepareActionJob(context.source, stored, stored.run);
  const carrier: Carrier = {
    transport: 'job',
    job: {
      scope: stored.scope,
      namespace: context.source.namespace.id,
      principal: stored.principal,
      transport,
      attempt: stored.attempt,
      ...(stored.retry === undefined ? {} : { retry: stored.retry }),
      ...(reaction ? { reaction: true as const } : {}),
      ...(reaction && stored.key !== undefined ? { key: stored.key.value } : {}),
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
  if (outcome.ok) {
    // The command of a tenant's job that runs in its backend's unit could not complete the job there.
    if (crossesScopes) await settleJobAttempt(context, stored, { kind: 'succeeded' });
    return;
  }
  // The history error of a job the kernel made is the closed projection, never the command's own
  // text (the module of the action declares the codes it may keep).
  const failure = reaction
    ? reactionJobError(
        outcome.error,
        declaredErrorCodesOf(
          context.source.registry,
          context.source.registry.reactions.get(action)?.module,
        ),
      )
    : stored.queue === timerQueue || stored.queue === scheduleQueue
      ? kernelJobError(
          outcome.error,
          declaredErrorCodesOf(
            context.source.registry,
            context.source.registry.actions.get(action)?.module,
          ),
          stored.queue === timerQueue ? 'timer' : 'schedule',
        )
      : outcome.error;
  const next = jobOutcomeOfError(failure, stored, context.clock.now(), context.random);
  if (next === undefined) return;
  await settleJobAttempt(context, stored, next);
}
