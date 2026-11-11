import type { JobOutcome } from '../storage/job-outcome.ts';
import type { StoredJob } from '../storage/stored-job.ts';
import { appendReceiptChange } from '../write-path/append-receipt-change.ts';
import { completeJob } from './complete-job.ts';
import { receiptOfJob } from './receipt-of-job.ts';
import type { RunJobContext } from './run-job.ts';

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
  outcome: JobOutcome,
): Promise<void> {
  const { source, writer } = context;
  const { run } = stored;
  await source.handle.adapter.unit(source.namespace, stored.scope, async (unit) => {
    if (
      (outcome.kind === 'failed' || outcome.kind === 'dead') &&
      'action' in run &&
      run.commandId !== undefined
    ) {
      const { action, commandId } = run;
      const receipt = await receiptOfJob(unit, stored, action, commandId);
      if (receipt?.status === 'accepted') {
        const failure = { ok: false, error: outcome.error } as const;
        await unit.receipts.complete(commandId, failure);
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
          },
          hybridClock: writer.hybridClock,
          now: context.clock.now(),
        });
      }
    }
    await completeJob(unit, { attempt: stored.attempt, worker: context.worker }, outcome);
  });
}
