import { errors } from '../errors/errors.ts';
import type { ErasureRecord } from '../ledger/erasure-record.ts';
import type { Registry } from '../registry/registry.ts';
import type { Receipt } from '../storage/receipt.ts';
import type { ReceiptOutcome } from '../storage/receipt-outcome.ts';
import type { Unit } from '../storage/unit.ts';
import { lostLeaseWireError } from '../worker/lost-lease-wire-error.ts';
import type { RunJobContext } from '../worker/run-job.ts';
import { appendReceiptChange } from '../write-path/append-receipt-change.ts';
import { commandReceiptUuid } from '../write-path/command-receipt-uuid.ts';
import { receiptExpiryAfter } from '../write-path/receipt-expiry-after.ts';

const receiptRef = 'core.commandReceipt';

/**
 * Whether a receipt may still become the completed one: it is the receipt of an erasure command
 * (a command id is reused once its receipt expired, so a receipt of another action under the same id
 * is another command's), and it is `accepted`, or failed because a sink was unavailable at step 1,
 * or failed because the job of the command lost its lease three times after the erasure was
 * recorded (its taker ends it with the lost-lease error, `settleExhaustedJob`): the erasure runs to
 * its end from the ledger either way. An erasure that was never recorded never reaches step 6, so
 * its receipt stays failed.
 */
function completable(receipt: Receipt): boolean {
  if (receipt.action !== 'core.eraseSubject') return false;
  if (receipt.status === 'accepted') return true;
  return (
    receipt.status === 'failed' &&
    receipt.outcome?.ok === false &&
    (receipt.outcome.error.code === 'core.unavailable' ||
      receipt.outcome.error.code === lostLeaseWireError.code)
  );
}

/**
 * Step 6 of section 14.7.5, last and in a unit of its own: completes the erasure command's
 * `accepted` receipt with `{ ok: true, value: { streams }, effects: [] }` and appends the change
 * record the submitter watches. A receipt that failed with `core.unavailable` or with a lost lease
 * is completed too (`completable`): the attempts of the job ended on a refusing ledger sink at step
 * 1, or its taker ended it after three lost leases once step 1 had recorded the erasure, and the
 * erasure has run to its end since, which is what the requester must read. A receipt that is
 * completed already, or failed for another reason, is left as it is, and a receipt that is gone (it
 * expired, or a restore rewound the placement) is not recreated: the erasure itself has finished
 * either way. The transition is conditional: the receipt's row is locked first and its status read
 * after the lock, so two workers on one erasure complete it once and append one change record. The
 * requester of the ledger record is the actor of the record.
 */
export async function completeErasureReceipt(
  unit: Unit,
  record: ErasureRecord,
  streams: number,
  context: Pick<RunJobContext, 'writer' | 'clock'> & { readonly registry: Registry },
): Promise<void> {
  const { scope } = unit;
  if (scope.level !== 'tenant') throw errors.internal('A receipt is completed in a tenant unit.');
  const entry = context.registry.entities.get(receiptRef);
  if (entry === undefined) throw errors.internal(`the app has no ${receiptRef} entity`);
  await unit.rows.findOne(entry.descriptor, {
    where: { op: 'eq', field: 'id', value: commandReceiptUuid(scope.tenantId, record.commandId) },
    select: ['id'],
    includeArchived: true,
    forUpdate: true,
  });
  const receipt = await unit.receipts.get(record.commandId);
  if (receipt === undefined || !completable(receipt)) return;
  const outcome: ReceiptOutcome = { ok: true, value: { streams }, effects: [] };
  await unit.receipts.complete(
    record.commandId,
    outcome,
    receiptExpiryAfter(context.registry.actions.get(receipt.action), context.clock.now()),
  );
  await appendReceiptChange(unit, {
    registry: context.registry,
    scope,
    receipt: { ...receipt, status: 'completed', outcome },
    meta: {
      actor: record.requester,
      commandId: record.commandId,
      action: receipt.action,
      causationId: null,
      correlationId: record.commandId,
      client: null,
      merge: null,
      traceparent: null,
      writer: {
        build: context.writer.build.id,
        revision: context.writer.build.revision,
      },
      flags: [],
      decision: null,
    },
    hybridClock: context.writer.hybridClock,
    now: context.clock.now(),
  });
}
