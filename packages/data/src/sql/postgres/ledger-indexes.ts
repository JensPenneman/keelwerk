import { assertNamespaceRoot } from './assert-namespace-root.ts';

/**
 * The indexes of framework step 0003 on the control root's `kw_ledger` (S-125), which answer the
 * lookups of `ControlLedger.find` and `unfinished`: an erasure or a completion by tenant, command
 * id and subject, a key tombstone by key id, and the tombstones of one scope in ledger order.
 * Stored format: final once released, changed only by a later framework step.
 */
export function ledgerIndexesDdl(root: string): readonly string[] {
  const schema = assertNamespaceRoot(root);
  return [
    `create index kw_ledger_erasure_identity on "${schema}".kw_ledger
  (type, (record->>'tenantId'), (record->>'commandId'), (record->>'subjectId'), seq)
  where type in ('erasure', 'erasureCompleted')`,
    `create index kw_ledger_tombstone_key on "${schema}".kw_ledger ((record->>'keyId')) where type = 'keyTombstone'`,
    `create index kw_ledger_tombstone_scope on "${schema}".kw_ledger ((record->>'scopeId'), seq) where type = 'keyTombstone'`,
  ];
}
