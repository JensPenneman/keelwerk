import { expectTypeOf, test } from 'vitest';
import type { ErasureRecord } from '../ledger/erasure-record.ts';
import type { KeyTombstoneRecord } from '../ledger/key-tombstone-record.ts';
import type { LedgerRecord } from './ledger-record.ts';

test('LedgerRecord narrows by type', () => {
  expectTypeOf<Extract<LedgerRecord, { type: 'erasure' }>>().toEqualTypeOf<ErasureRecord>();
  expectTypeOf<
    Extract<LedgerRecord, { type: 'keyTombstone' }>
  >().toEqualTypeOf<KeyTombstoneRecord>();
  expectTypeOf<Extract<LedgerRecord, { type: 'anchor' }>['position']>().toEqualTypeOf<string>();
  function typeOf(record: LedgerRecord): string {
    switch (record.type) {
      case 'anchor':
      case 'erasure':
      case 'keyTombstone':
        return record.type;
      default: {
        const unreachable: never = record;
        return unreachable;
      }
    }
  }
  expectTypeOf(typeOf).returns.toEqualTypeOf<string>();
});

test('the stored erasure and tombstone records keep their member names and forms', () => {
  expectTypeOf<keyof ErasureRecord>().toEqualTypeOf<
    'type' | 'tenantId' | 'subjectId' | 'recordedAt' | 'requester' | 'reason' | 'commandId'
  >();
  expectTypeOf<keyof KeyTombstoneRecord>().toEqualTypeOf<
    'type' | 'scopeId' | 'keyId' | 'recordedAt' | 'reason'
  >();
  expectTypeOf<ErasureRecord['recordedAt']>().toEqualTypeOf<string>();
  expectTypeOf<KeyTombstoneRecord['recordedAt']>().toEqualTypeOf<string>();
  expectTypeOf<KeyTombstoneRecord['reason']>().toEqualTypeOf<
    'erasure' | 'rotation' | 'tenantDeleted'
  >();
});
