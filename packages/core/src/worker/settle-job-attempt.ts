import { timerQueue } from '../effects/timer-queue.ts';
import { KeelwerkError } from '../errors/keelwerk-error.ts';
import { declaredErrorCodesOf } from '../executors/declared-error-codes-of.ts';
import { reactionLineageOf } from '../reactions/reaction-lineage-of.ts';
import { reactionQueue } from '../reactions/reaction-queue.ts';
import { scheduleQueue } from '../schedules/schedule-queue.ts';
import type { JobOutcome } from '../storage/job-outcome.ts';
import type { StoredJob } from '../storage/stored-job.ts';
import { appendReceiptChange } from '../write-path/append-receipt-change.ts';
import { receiptExpiryAfter } from '../write-path/receipt-expiry-after.ts';
import { commandJobError } from './command-job-error.ts';
import { completeJob } from './complete-job.ts';
import { kernelJobError } from './kernel-job-error.ts';
import { receiptOfJob } from './receipt-of-job.ts';
import type { RunJobContext } from './run-job.ts';

/**
 * What a command job stores of a failure, whichever way the attempt ended (D9): `commandJobError`'s
 * projection, so the receipt, its change record, the job's history and a dead job never hold the
 * data of a declared error. A timer's and a schedule's failure is the closed projection of
 * `kernelJobError` (its message names the timer or the schedule); a reaction's failure is projected
 * by its own worker.
 */
function projected(
  registry: RunJobContext['source']['registry'],
  stored: StoredJob,
  outcome: JobOutcome,
): JobOutcome {
  if (outcome.kind === 'succeeded' || stored.queue === reactionQueue) return outcome;
  const { run } = stored;
  if (!('action' in run) || run.commandId === undefined) return outcome;
  const { error } = outcome;
  const failure = new KeelwerkError({
    kind: error.kind,
    code: error.code,
    message: error.message,
    retryable: error.retryable,
    ...(error.retryAfter === undefined ? {} : { retryAfter: error.retryAfter }),
  });
  const declared = declaredErrorCodesOf(registry, registry.actions.get(run.action)?.module);
  const stable =
    stored.queue === timerQueue
      ? kernelJobError(failure, declared, 'timer')
      : stored.queue === scheduleQueue
        ? kernelJobError(failure, declared, 'schedule')
        : commandJobError(failure, declared);
  const wire = {
    kind: stable.kind,
    code: stable.code,
    message: stable.message,
    retryable: stable.retryable,
    ...(stable.retryAfter === undefined ? {} : { retryAfter: stable.retryAfter }),
    requestId: error.requestId,
  };
  return { ...outcome, error: wire };
}

/**
 * Completes an attempt in one unit of the job's scope (D5): one that did not succeed, and the
 * `succeeded` attempt of a tenant's job whose command ran in the tenant's backend unit, which
 * could not complete it there (`completeJobHere`). An attempt that
 * ends the job (`failed`, `dead`) also fails the job's own `accepted` receipt and appends its change
 * record, so the submitter reads the failure; a receipt that is not the job's own (another
 * principal's, or another command's) is left as it is. The unit is the one a handler that threw is
 * completed in too, so no way out of a job leaves its receipt `accepted`.
 */
export async function settleJobAttempt(
  context: Pick<RunJobContext, 'source' | 'worker' | 'writer' | 'clock'>,
  stored: StoredJob,
  attempted: JobOutcome,
): Promise<void> {
  const { source, writer } = context;
  const { run } = stored;
  const outcome = projected(context.source.registry, stored, attempted);
  await source.handle.adapter.unit(source.namespace, stored.scope, async (unit) => {
    if (
      (outcome.kind === 'failed' || outcome.kind === 'dead') &&
      'action' in run &&
      run.commandId !== undefined
    ) {
      const { action, commandId } = run;
      const receipt = await receiptOfJob(unit, stored, action, commandId);
      const lineage = reactionLineageOf(stored.causation.lineage);
      if (receipt?.status === 'accepted') {
        const failure = { ok: false, error: outcome.error } as const;
        await unit.receipts.complete(
          commandId,
          failure,
          receiptExpiryAfter(source.registry.actions.get(action), context.clock.now()),
        );
        await appendReceiptChange(unit, {
          registry: source.registry,
          scope: stored.scope,
          receipt: { ...receipt, status: 'failed', outcome: failure },
          meta: {
            actor: stored.causation.actor ?? { kind: 'system', id: null, via: 'core.runtime' },
            commandId,
            action,
            causationId: null,
            correlationId: commandId,
            client: null,
            merge: null,
            traceparent: null,
            writer: { build: writer.build.id, revision: writer.build.revision },
            flags: [],
            decision: null,
            ...(lineage === undefined ? {} : { lineage }),
          },
          hybridClock: writer.hybridClock,
          now: context.clock.now(),
        });
      }
    }
    await completeJob(unit, { attempt: stored.attempt, worker: context.worker }, outcome);
  });
}
