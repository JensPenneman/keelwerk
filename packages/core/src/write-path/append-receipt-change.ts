import type { HybridClock } from '../clock/hybrid-clock.ts';
import { errors } from '../errors/errors.ts';
import type { EventMeta } from '../events/event-meta.ts';
import { newUuidV7 } from '../ids/new-uuid-v7.ts';
import type { Registry } from '../registry/registry.ts';
import type { Receipt } from '../storage/receipt.ts';
import type { Scope } from '../storage/scope.ts';
import type { Unit } from '../storage/unit.ts';
import { commandReceiptUuid } from './command-receipt-uuid.ts';
import { encodeEventValue } from './encode-event-value.ts';

/** The stream type of a receipt's change records. */
const receiptEntity = 'core.commandReceipt';

/** The members the `created` record carries: what a watcher needs to recognise the receipt, never the principal, the fingerprint or the request metadata. */
function createdValues(receipt: ReceiptChange['receipt']): Record<string, unknown> {
  const values: Record<string, unknown> = {
    commandId: receipt.commandId,
    action: receipt.action,
    status: receipt.status,
    apiVersion: receipt.apiVersion,
    expiresAt: receipt.expiresAt,
  };
  if (receipt.principalResolver !== null) values.principalResolver = receipt.principalResolver;
  if (receipt.principalId !== null) values.principalId = receipt.principalId;
  if (receipt.clientId !== null) values.clientId = receipt.clientId;
  if (receipt.clientSeq !== null) values.clientSeq = receipt.clientSeq;
  return values;
}

/** What a change record of a receipt is built from (S-145). */
export interface ReceiptChange {
  readonly registry: Registry;
  readonly scope: Scope;
  readonly receipt: Pick<
    Receipt,
    | 'commandId'
    | 'action'
    | 'status'
    | 'outcome'
    | 'apiVersion'
    | 'principalResolver'
    | 'principalId'
    | 'clientId'
    | 'clientSeq'
    | 'expiresAt'
  >;
  readonly meta: EventMeta;
  readonly hybridClock: HybridClock;
  readonly now: Temporal.Instant;
}

/**
 * Appends the transient change record of a receipt that an asynchronous command moved (S-145, D2):
 * `created` when the command is accepted, `changed` with the new status and outcome when a worker
 * completes or fails it. The stream is the receipt's (`core.commandReceipt`, the id derived from
 * the scope id and the command id); its version follows the stream, not the row, because
 * synchronous receipts, takeovers and acknowledgements change the row without a record. Records
 * are transient (no hash chain) and ride the unit, so they commit with the receipt. A deployment
 * scope writes nothing: invocation-scoped streams belong to tenant and backend units.
 */
export async function appendReceiptChange(unit: Unit, change: ReceiptChange): Promise<void> {
  const { scope, receipt } = change;
  if (scope.level === 'deployment') return;
  const entry = change.registry.entities.get(receiptEntity);
  if (entry === undefined) throw errors.internal(`the app has no ${receiptEntity} entity`);
  const stream = {
    type: receiptEntity,
    id: commandReceiptUuid(
      scope.level === 'tenant' ? scope.tenantId : scope.backendId,
      receipt.commandId,
    ),
  };
  const version = (await unit.events.readStream(stream)).at(-1)?.version ?? 0;
  const created = receipt.status === 'accepted';
  await unit.events.append([
    {
      stream,
      expectedVersion: version,
      partition: null,
      events: [
        {
          eventId: newUuidV7(),
          name: created ? 'created' : 'changed',
          schemaVersion: 1,
          shape: entry.descriptor.shape.id,
          data: created
            ? { values: encodeEventValue(createdValues(receipt)) }
            : { set: encodeEventValue({ status: receipt.status, outcome: receipt.outcome }) },
          before: null,
          hlc: change.hybridClock.tick(change.now.epochMilliseconds),
          recordedAt: change.now,
          meta: change.meta,
          transient: true,
          prevHash: null,
          hash: null,
        },
      ],
    },
  ]);
}
