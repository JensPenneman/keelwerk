import type { ErasureRecord } from '../ledger/erasure-record.ts';
import { erasureKey } from '../subjects/erasure-key.ts';
import type { ReplayContext, ReplayOptions } from './replay-ledger-records.ts';
import { replayLedgerRecords } from './replay-ledger-records.ts';

/**
 * The erasure records of the deployment, from the control store's ledger and then from every ledger
 * sink (14.7.6), each erasure once (`erasureKey`: tenant, command id and subject, because a command id
 * is unique in one scope only): the sinks are outside the placement and its backups, so a
 * record the control copy lost to a restore is still found. `options` is `replayLedgerRecords`'.
 */
export function replayErasureRecords(
  context: ReplayContext,
  options?: ReplayOptions,
): AsyncGenerator<ErasureRecord, void, undefined> {
  return replayLedgerRecords(
    context,
    (record) => (record.type === 'erasure' ? record : undefined),
    erasureKey,
    options,
  );
}
