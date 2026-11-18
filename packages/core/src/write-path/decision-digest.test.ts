import { describe, expect, it } from 'vitest';
import type { DataKey } from '../storage/data-key.ts';
import { decisionDigest } from './decision-digest.ts';

const fingerprint = 'f'.repeat(64);
const keyA: DataKey = { id: 'key-a', material: new Uint8Array(32).fill(1) };
const keyB: DataKey = { id: 'key-b', material: new Uint8Array(32).fill(2) };

describe('the input digest of a decision record', () => {
  // WP-130: a stored format of the decision record in kw_events; the vectors were computed outside
  // the kernel.
  it('is final: golden digests', () => {
    expect(decisionDigest(fingerprint, [keyA])).toBe(
      '00c47fdb8144ddf646347ff681356f86da270856c9f1c476c290a20b621d8c08',
    );
    expect(decisionDigest(fingerprint, [keyA, keyB])).toBe(
      'f1dd4fc16960b3205b0397d475de4c9c9f543de22fe65664ece21cdd29a3f9c7',
    );
  });

  it('answers the fingerprint itself when no key was used', () => {
    expect(decisionDigest(fingerprint, [])).toBe(fingerprint);
  });

  it('does not depend on the order of the keys or on a key given twice', () => {
    const digest = decisionDigest(fingerprint, [keyA, keyB]);
    expect(decisionDigest(fingerprint, [keyB, keyA])).toBe(digest);
    expect(decisionDigest(fingerprint, [keyA, keyB, keyA])).toBe(digest);
  });

  it('changes with another key and with another fingerprint', () => {
    const other: DataKey = { id: 'key-a', material: new Uint8Array(32).fill(3) };
    expect(decisionDigest(fingerprint, [other])).not.toBe(decisionDigest(fingerprint, [keyA]));
    expect(decisionDigest(fingerprint, [keyA, keyB])).not.toBe(decisionDigest(fingerprint, [keyA]));
    expect(decisionDigest('0'.repeat(64), [keyA])).not.toBe(decisionDigest(fingerprint, [keyA]));
  });
});
