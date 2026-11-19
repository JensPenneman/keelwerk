import { errors } from '../errors/errors.ts';
import { refuseRequest } from '../interpreter/refuse-request.ts';
import { type ErasureReason, erasureReasons } from '../ledger/erasure-reasons.ts';
import type { ErasureRecord } from '../ledger/erasure-record.ts';
import type { StoredJob } from '../storage/stored-job.ts';
import { completeJob } from '../worker/complete-job.ts';
import type { RunJobContext } from '../worker/run-job.ts';
import { canonicalSubject } from './canonical-subject.ts';
import { erasureAction } from './erasure-action.ts';
import { isErasureRecorded } from './is-erasure-recorded.ts';
import { ownedRows } from './owned-rows.ts';

const reasons: ReadonlySet<string> = new Set(erasureReasons);
const kernelActor = { kind: 'system', id: null, via: 'core.runtime' } as const;

/**
 * Step 1 of section 14.7.5, in the job of `core.eraseSubject`. A job whose erasure is recorded in the
 * control ledger already (an attempt that lost its lease after the append, or ran again after the
 * worker shredded) completes at once: nothing else is looked at, because the subject's keys may be
 * gone by then. Otherwise the job must hold the accepted receipt of its command id in its tenant
 * (only `acceptAsyncCommand` writes one, after the rules and the ownership check, or the own-subject request of `eraseOwnSubject`, after `checkOwnSubjectErasure`): without it, or
 * with one that expired before the job ran, the job fails without a retry and the requester asks
 * again. Then it refuses (`not_found`, nothing written) a subject that has no key row, no
 * reference, no shredded key and no owned row in the job's tenant (a row that holds no personal value counts), so no answer tells another tenant's subject from an unknown one;
 * otherwise appends the `ErasureRecord` (requester: the job's causation actor, command id: the
 * job's, subject: the canonical form of the one asked for) to the control store's ledger and then to every ledger sink, and completes the job. A sink
 * that refuses fails the attempt, which is retried; a record appended twice is harmless, as readers
 * keep the first record of a command id. The command's receipt stays `accepted` until the events
 * worker has finished the last step.
 */
export async function startErasure(
  context: RunJobContext,
  stored: StoredJob,
  input: { readonly subjectId: string; readonly reason: string },
): Promise<void> {
  const { scope, run } = stored;
  const commandId = 'commandId' in run ? run.commandId : undefined;
  if (scope.level !== 'tenant' || commandId === undefined) {
    throw errors.internal('An erasure runs as a command of one tenant.');
  }
  if (!reasons.has(input.reason)) {
    throw errors.validation('The reason of an erasure is one of a closed list.');
  }
  const { source } = context;
  const { adapter } = source.handle;
  const complete = (): Promise<unknown> =>
    adapter.unit(source.namespace, scope, (unit) =>
      completeJob(unit, { attempt: stored.attempt, worker: context.worker }, { kind: 'succeeded' }),
    );
  const erasure = { tenantId: scope.tenantId, commandId, subjectId: input.subjectId };
  if (await isErasureRecorded(context.control.ledger, erasure)) {
    await complete();
    return;
  }
  const now = context.clock.now();
  const { accepted, known } = await adapter.unit(
    source.namespace,
    scope,
    async (unit) => {
      const receipt = await unit.receipts.get(commandId);
      return {
        accepted:
          receipt?.status === 'accepted' &&
          receipt.action === erasureAction &&
          Temporal.Instant.compare(receipt.expiresAt, now) > 0,
        known:
          (await unit.keys.dataKey(input.subjectId, { create: false })) !== undefined ||
          // A key the worker shredded already still makes the subject known: an attempt that runs
          // again after the shred is not refused as unknown.
          (await unit.keys.shreddedKeys(input.subjectId)).length > 0 ||
          (await unit.keys.refs(input.subjectId, null, 1)).length > 0 ||
          (
            await ownedRows(unit, {
              registry: source.registry,
              subjectId: input.subjectId,
              includeErased: true,
              after: null,
              limit: 1,
            })
          ).rows.length > 0,
      };
    },
    { readOnly: true },
  );
  if (!accepted) {
    throw refuseRequest(
      `the job of "${erasureAction}"`,
      'an erasure starts only from the accepted command it answers',
    );
  }
  if (!known) throw errors.not_found('The subject does not exist.');
  const record: ErasureRecord = {
    type: 'erasure',
    tenantId: scope.tenantId,
    subjectId: canonicalSubject(input.subjectId),
    recordedAt: now.toString(),
    requester: stored.causation.actor ?? kernelActor,
    reason: input.reason as ErasureReason,
    commandId,
  };
  await context.control.ledger.append(record);
  for (const sink of context.ledgers) {
    try {
      await sink.append([record]);
    } catch (cause) {
      throw errors.unavailable('A ledger sink refused the erasure record.', { cause });
    }
  }
  await complete();
}
