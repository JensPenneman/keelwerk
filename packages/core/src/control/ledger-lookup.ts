/** What the indexes of framework step 0003 answer: one erasure identity, one tombstone key, or the tombstones of one scope. */
export type LedgerLookup =
  | {
      readonly type: 'erasure' | 'erasureCompleted';
      readonly tenantId: string;
      readonly commandId: string;
      readonly subjectId: string;
    }
  | { readonly type: 'keyTombstone'; readonly keyId: string }
  | { readonly type: 'keyTombstone'; readonly scopeId: string };
