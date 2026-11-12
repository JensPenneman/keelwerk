import type { ErasureCompletedRecord, ErasureRecord } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import { createCompletions } from '../../src/erasure/create-completions.ts';

const tenantId = '0192f3a0-0000-7000-8000-000000000001';
const subjectId = '0192f3a0-0000-7000-8000-0000000000a1';

const erasure: ErasureRecord = {
  type: 'erasure',
  tenantId,
  subjectId,
  recordedAt: '2026-11-12T08:00:00.000Z',
  requester: { kind: 'operator', id: null, via: 'core.operator' },
  reason: 'subjectRequest',
  commandId: 'c1',
};
const completion: ErasureCompletedRecord = {
  type: 'erasureCompleted',
  tenantId,
  commandId: 'c1',
  subjectId,
  epoch: 0,
  recordedAt: '2026-11-12T08:00:02.000Z',
};

describe('the completions that count for an erasure', () => {
  test('a completion counts only when it stands after the record of its erasure in ledger order', () => {
    const before = createCompletions();
    before.observe(completion);
    before.observe(erasure);
    expect(before.of(erasure)).toEqual([]);

    const after = createCompletions();
    after.observe(erasure);
    after.observe(completion);
    expect(after.of(erasure)).toEqual([completion]);
  });

  test('a completion of another tenant, another command id or another subject does not count', () => {
    const completions = createCompletions();
    completions.observe(erasure);
    completions.observe({ ...completion, tenantId: '0192f3a0-0000-7000-8000-000000000002' });
    completions.observe({ ...completion, commandId: 'c2' });
    completions.observe({ ...completion, subjectId: '0192f3a0-0000-7000-8000-0000000000a2' });
    expect(completions.of(erasure)).toEqual([]);
    completions.observe(completion);
    expect(completions.of(erasure)).toEqual([completion]);
  });

  test('a completion left from before a record is not counted for a later record of the same erasure', () => {
    const completions = createCompletions();
    completions.observe(completion);
    completions.observe(erasure);
    const later = { ...completion, epoch: 1, recordedAt: '2026-11-12T09:00:00.000Z' };
    completions.observe(later);
    expect(completions.of(erasure)).toEqual([later]);
  });
});
