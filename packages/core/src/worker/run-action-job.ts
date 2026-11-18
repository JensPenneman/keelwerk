import { hookQueue } from '../control/hook-queue.ts';
import { RestoreHoldRefusal } from '../control/restore-hold-refusal.ts';
import { timerQueue } from '../effects/timer-queue.ts';
import { declaredErrorCodesOf } from '../executors/declared-error-codes-of.ts';
import { newUuidV7 } from '../ids/new-uuid-v7.ts';
import { refuseRequest } from '../interpreter/refuse-request.ts';
import type { Carrier } from '../invoker/carrier.ts';
import type { Job } from '../jobs/job.ts';
import { reactionJobError } from '../reactions/reaction-job-error.ts';
import { reactionLineageOf } from '../reactions/reaction-lineage-of.ts';
import { reactionQueue } from '../reactions/reaction-queue.ts';
import { scheduleQueue } from '../schedules/schedule-queue.ts';
import { erasureAction } from '../subjects/erasure-action.ts';
import { startErasure } from '../subjects/start-erasure.ts';
import { PersonalKeyDestroyed } from '../write-path/personal-key-destroyed.ts';
import { commandJobError } from './command-job-error.ts';
import { endJobAfterErasure } from './end-job-after-erasure.ts';
import { isCrossScopeJob } from './is-cross-scope-job.ts';
import { jobOutcomeOfError } from './job-outcome-of-error.ts';
import { kernelJobError } from './kernel-job-error.ts';
import { type PreparedJob, prepareActionJob } from './prepare-action-job.ts';
import { recordHookOutcome } from './record-hook-outcome.ts';
import type { RunJobContext } from './run-job.ts';
import { settleHeldJob } from './settle-held-job.ts';
import { settleJobAttempt } from './settle-job-attempt.ts';

/**
 * Runs an action job through the invoker (9.5.6, S-122): the carrier holds the job's scope and
 * principal reference, so scope and principal are resolved again and the gate and the item checks
 * run against the current state. The input's secret members are opened first, and the gate judges
 * the transport of the job's own receipt, or an unknown transport when it has none
 * (`prepareActionJob`); a job whose personal member names an erased subject ends there
 * (`endJobAfterErasure`). A command that succeeds completes the attempt in its own unit; only the
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
  if (action === erasureAction) {
    // The erasure command never runs `decide`: its job writes the ledger record (14.7.5 step 1).
    const erase = stored.run.input as { readonly subjectId: string; readonly reason: string };
    await startErasure(context, stored, erase);
    return;
  }
  // A reaction job's input is the event reference the dispatcher stored: it holds no secret member and no receipt of
  // its own, so there is nothing to prepare, and the gate judges an unknown transport.
  const reaction = stored.queue === reactionQueue;
  // A hook job's input is the hook's payload, which holds no secret member either: nothing to prepare.
  const hook = stored.queue === hookQueue;
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
  let prepared: PreparedJob;
  try {
    prepared =
      reaction || hook
        ? { input: stored.run.input, transport: null }
        : await prepareActionJob(context.source, stored, stored.run);
  } catch (error) {
    // The key of a personal member is destroyed: nothing will ever open the input again.
    if (!(error instanceof PersonalKeyDestroyed)) throw error;
    await endJobAfterErasure(context, stored, error);
    return;
  }
  const { input, transport } = prepared;
  const lineage = reactionLineageOf(stored.causation.lineage);
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
      ...(hook ? { hook: true as const } : {}),
      ...(reaction && stored.key !== undefined ? { key: stored.key.value } : {}),
      ...(stored.causation.eventId === undefined ? {} : { causationId: stored.causation.eventId }),
      ...(lineage === undefined ? {} : { lineage }),
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
    // A hook that succeeds after an attempt failed closes the failure the first attempt recorded.
    if (hook && stored.attempt.attempt > 1)
      await recordHookOutcome(context, stored, 'hookCompleted');
    return;
  }
  // A tenant held by a restore refuses its jobs until the hold lifts: they wait and keep their attempt.
  if (outcome.error instanceof RestoreHoldRefusal) {
    await settleHeldJob(context, stored, outcome.error);
    return;
  }
  // The history error of a job the kernel made is the closed projection, never the command's own
  // text (the module of the action declares the codes it may keep): a reaction's, a timer's and a
  // schedule's by their own subject, any other command's by `commandJobError` (D9), so its receipt,
  // its change record, its history and a dead job never hold a declared error's data.
  const failure = reaction
    ? reactionJobError(
        outcome.error,
        declaredErrorCodesOf(
          context.source.registry,
          context.source.registry.reactions.get(action)?.module,
        ),
      )
    : hook
      ? kernelJobError(
          outcome.error,
          declaredErrorCodesOf(
            context.source.registry,
            context.source.registry.hooks.get(action)?.module,
          ),
          'hook',
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
        : commandJobError(
            outcome.error,
            declaredErrorCodesOf(
              context.source.registry,
              context.source.registry.actions.get(action)?.module,
            ),
          );
  const next = jobOutcomeOfError(failure, stored, context.clock.now(), context.random);
  if (next === undefined) return;
  await settleJobAttempt(context, stored, next);
  // `hookFailed` is recorded for `keelwerk doctor` at the first attempt that fails and again at
  // every attempt that ends the job (no retry follows): an attempt lost to a redeploy or a lapsed
  // lease records nothing, so the attempts after it must still put a dead hook on the operator's
  // list. A hook whose first attempt failed and whose later attempt ends the job therefore records
  // twice; the record is keyed by tenant and hook, so the second replaces the first. A retry after
  // the first attempt records nothing.
  if (hook && (stored.attempt.attempt === 1 || next.kind !== 'retry')) {
    await recordHookOutcome(context, stored, 'hookFailed');
  }
}
