create index kw_ledger_erasure_identity on "kw__control".kw_ledger
  (type, (record->>'tenantId'), (record->>'commandId'), (record->>'subjectId'), seq)
  where type in ('erasure', 'erasureCompleted');

create index kw_ledger_tombstone_key on "kw__control".kw_ledger ((record->>'keyId')) where type = 'keyTombstone';

create index kw_ledger_tombstone_scope on "kw__control".kw_ledger ((record->>'scopeId'), seq) where type = 'keyTombstone';
