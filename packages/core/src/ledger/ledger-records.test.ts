import { describe, expect, test } from 'vitest';
import { encodeLedgerRecord } from './encode-ledger-record.ts';
import type { ErasureCompletedRecord } from './erasure-completed-record.ts';
import { erasureReasons } from './erasure-reasons.ts';
import type { ErasureRecord } from './erasure-record.ts';
import type { KeyTombstoneRecord } from './key-tombstone-record.ts';
import { parseLedgerLine } from './parse-ledger-line.ts';

const erasure: ErasureRecord = {
  type: 'erasure',
  tenantId: '0192f3a0-0000-7000-8000-000000000001',
  subjectId: '0192f3a0-0000-7000-8000-0000000000a1',
  recordedAt: '2026-11-11T09:30:00.000Z',
  requester: { kind: 'operator', id: '0192f3a0-0000-7000-8000-0000000000e1', via: 'core.operator' },
  reason: 'subjectRequest',
  commandId: '0192f3a0-0000-7000-8000-0000000000c1',
};

const completed: ErasureCompletedRecord = {
  type: 'erasureCompleted',
  tenantId: '0192f3a0-0000-7000-8000-000000000001',
  commandId: '0192f3a0-0000-7000-8000-0000000000c1',
  subjectId: '0192f3a0-0000-7000-8000-0000000000a1',
  epoch: 0,
  recordedAt: '2026-11-11T09:30:02.000Z',
};

const tombstone: KeyTombstoneRecord = {
  type: 'keyTombstone',
  scopeId: '0192f3a0-0000-7000-8000-000000000001',
  keyId: 'k1',
  recordedAt: '2026-11-11T09:30:01.000Z',
  reason: 'erasure',
};

const erasureLine =
  '{"commandId":"0192f3a0-0000-7000-8000-0000000000c1","reason":"subjectRequest","recordedAt":"2026-11-11T09:30:00.000Z","requester":{"id":"0192f3a0-0000-7000-8000-0000000000e1","kind":"operator","via":"core.operator"},"subjectId":"0192f3a0-0000-7000-8000-0000000000a1","tenantId":"0192f3a0-0000-7000-8000-000000000001","type":"erasure"}';
// New record type, so there is no older vector to keep: this line is the first and, once written, final.
const completedLine =
  '{"commandId":"0192f3a0-0000-7000-8000-0000000000c1","epoch":0,"recordedAt":"2026-11-11T09:30:02.000Z","subjectId":"0192f3a0-0000-7000-8000-0000000000a1","tenantId":"0192f3a0-0000-7000-8000-000000000001","type":"erasureCompleted"}';
const tombstoneLine =
  '{"keyId":"k1","reason":"erasure","recordedAt":"2026-11-11T09:30:01.000Z","scopeId":"0192f3a0-0000-7000-8000-000000000001","type":"keyTombstone"}';

function without(record: object, member: string): string {
  const copy: Record<string, unknown> = { ...record };
  delete copy[member];
  return JSON.stringify(copy);
}

describe('the erasure and keyTombstone ledger records (F-20, S-176)', () => {
  test('golden: an erasure record is one line of canonical JSON and parses back equal', () => {
    expect(encodeLedgerRecord(erasure)).toBe(erasureLine);
    expect(parseLedgerLine(erasureLine)).toEqual(erasure);
  });

  test('golden: a key tombstone is one line of canonical JSON and parses back equal', () => {
    expect(encodeLedgerRecord(tombstone)).toBe(tombstoneLine);
    expect(parseLedgerLine(tombstoneLine)).toEqual(tombstone);
  });

  test('a key tombstone may name the erasure command that recorded it, and only as a text', () => {
    const named: KeyTombstoneRecord = { ...tombstone, commandId: erasure.commandId };
    expect(parseLedgerLine(encodeLedgerRecord(named))).toEqual(named);
    expect(parseLedgerLine(JSON.stringify({ ...tombstone, commandId: 7 }))).toEqual(tombstone);
  });

  test('golden: an erasure completion is one line of canonical JSON and parses back equal', () => {
    expect(encodeLedgerRecord(completed)).toBe(completedLine);
    expect(parseLedgerLine(completedLine)).toEqual(completed);
  });

  test('a completion with a member missing or of the wrong form parses to undefined', () => {
    for (const member of Object.keys(completed)) {
      if (member === 'type') continue;
      expect(parseLedgerLine(without(completed, member))).toBeUndefined();
    }
    for (const epoch of [-1, 1.5, '0', null, Number.MAX_SAFE_INTEGER + 2]) {
      expect(parseLedgerLine(JSON.stringify({ ...completed, epoch }))).toBeUndefined();
    }
    expect(
      parseLedgerLine(JSON.stringify({ ...completed, recordedAt: '2026-11-11' })),
    ).toBeUndefined();
    expect(parseLedgerLine(JSON.stringify({ ...completed, subjectId: 7 }))).toBeUndefined();
  });

  test('an anonymous requester with a null id is a valid record', () => {
    const record: ErasureRecord = {
      ...erasure,
      requester: { kind: 'system', id: null, via: 'core.system' },
    };
    expect(parseLedgerLine(encodeLedgerRecord(record))).toEqual(record);
  });

  test('a line missing any member parses to undefined', () => {
    for (const member of Object.keys(erasure)) {
      // The reason is the one member a reader may read as unknown: see the test below.
      if (member === 'type' || member === 'reason') continue;
      expect(parseLedgerLine(without(erasure, member))).toBeUndefined();
    }
    for (const member of Object.keys(tombstone)) {
      if (member === 'type') continue;
      expect(parseLedgerLine(without(tombstone, member))).toBeUndefined();
    }
  });

  test('a member of the wrong form parses to undefined', () => {
    expect(parseLedgerLine(JSON.stringify({ ...tombstone, reason: 'because' }))).toBeUndefined();
    expect(
      parseLedgerLine(JSON.stringify({ ...tombstone, recordedAt: '2026-11-11' })),
    ).toBeUndefined();
    expect(
      parseLedgerLine(JSON.stringify({ ...erasure, recordedAt: 'yesterday' })),
    ).toBeUndefined();
    expect(parseLedgerLine(JSON.stringify({ ...erasure, requester: 'someone' }))).toBeUndefined();
    expect(
      parseLedgerLine(
        JSON.stringify({ ...erasure, requester: { kind: 'robot', id: null, via: 'x' } }),
      ),
    ).toBeUndefined();
    expect(
      parseLedgerLine(JSON.stringify({ ...erasure, requester: { kind: 'user', id: 7, via: 'x' } })),
    ).toBeUndefined();
    expect(parseLedgerLine(JSON.stringify({ ...erasure, subjectId: 7 }))).toBeUndefined();
  });

  test('every reason of the closed list parses as it is', () => {
    for (const reason of erasureReasons) {
      expect(parseLedgerLine(JSON.stringify({ ...erasure, reason }))).toEqual({
        ...erasure,
        reason,
      });
    }
  });

  test('a reason the reader does not know keeps the record and reads as operator', () => {
    for (const reason of ['gdpr-art17-0471234567', 'jan.peeters@example.com', '']) {
      expect(parseLedgerLine(JSON.stringify({ ...erasure, reason }))).toEqual({
        ...erasure,
        reason: 'operator',
      });
    }
  });

  test('a reason that is absent or no text keeps the record and reads as operator', () => {
    const expected = { ...erasure, reason: 'operator' };
    expect(parseLedgerLine(without(erasure, 'reason'))).toEqual(expected);
    for (const reason of [7, {}, null, { kind: 'retention', days: 30 }]) {
      expect(parseLedgerLine(JSON.stringify({ ...erasure, reason }))).toEqual(expected);
    }
  });

  test('an unknown type is skipped', () => {
    expect(parseLedgerLine('{"type":"rotation","scopeId":"x"}')).toBeUndefined();
  });
});
