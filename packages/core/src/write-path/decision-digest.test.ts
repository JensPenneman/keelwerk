import { createHmac, hkdfSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { DataKey } from '../storage/data-key.ts';
import { decisionDigest } from './decision-digest.ts';

const base = `kwb1.${'f'.repeat(64)}`;
const keyA: DataKey = { id: 'key-a', material: new Uint8Array(32).fill(1) };
const keyB: DataKey = { id: 'key-b', material: new Uint8Array(32).fill(2) };

/**
 * The rekey written out with node:crypto alone: the AAD is the info, 4-byte lengths in front of
 * each part.
 */
function rekeyed(text: string, keys: readonly DataKey[]): string {
  const ids = keys.map((key) => key.id).sort();
  const parts = ['keelwerk/decision-digest/v1', ...ids].map((part) => Buffer.from(part));
  const info = Buffer.concat(
    parts.map((part) => {
      const length = Buffer.alloc(4);
      length.writeUInt32BE(part.length);
      return Buffer.concat([length, part]);
    }),
  );
  const material = Buffer.concat(keys.map((key) => key.material));
  const secret = Buffer.from(hkdfSync('sha256', material, '', info, 32));
  return `kwd1.${createHmac('sha256', secret).update(text).digest('hex')}`;
}

describe('the input digest of a decision record', () => {
  // WP-158: a stored format of the decision record in kw_events; the vectors were computed outside
  // the kernel. The message of the HMAC is the whole text of the decision base, prefix included.
  it('is final: golden digests', () => {
    expect(decisionDigest(base, [keyA])).toBe(
      'kwd1.911f688eec3d322c3aa281dad51cbb3c474db6642235b2afd7bdf3430cf57867',
    );
    expect(decisionDigest(base, [keyA, keyB])).toBe(
      'kwd1.d6f9c844e5965aec8860b4324d266fbff46a585ca77fe905ca966625687669f5',
    );
    expect(decisionDigest(base, [keyA])).toBe(rekeyed(base, [keyA]));
    expect(decisionDigest(base, [keyA, keyB])).toBe(rekeyed(base, [keyA, keyB]));
  });

  it('no keys answers the base itself', () => {
    expect(decisionDigest(base, [])).toBe(base);
  });

  it('keys answer a kwd1 text of 64 hex characters', () => {
    expect(decisionDigest(base, [keyA])).toMatch(/^kwd1\.[0-9a-f]{64}$/);
  });

  it('rekeys a kwd1 text: the whole current text is the message', () => {
    const once = decisionDigest(base, [keyA]);
    const twice = decisionDigest(once, [keyB]);
    expect(twice).toBe(rekeyed(once, [keyB]));
    expect(twice).toMatch(/^kwd1\.[0-9a-f]{64}$/);
    expect(twice).not.toBe(once);
  });

  it('does not depend on the order of the keys or on a key given twice', () => {
    const digest = decisionDigest(base, [keyA, keyB]);
    expect(decisionDigest(base, [keyB, keyA])).toBe(digest);
    expect(decisionDigest(base, [keyA, keyB, keyA])).toBe(digest);
  });

  it('changes with another key and with another base', () => {
    const other: DataKey = { id: 'key-a', material: new Uint8Array(32).fill(3) };
    expect(decisionDigest(base, [other])).not.toBe(decisionDigest(base, [keyA]));
    expect(decisionDigest(base, [keyA, keyB])).not.toBe(decisionDigest(base, [keyA]));
    expect(decisionDigest(`kwb1.${'0'.repeat(64)}`, [keyA])).not.toBe(decisionDigest(base, [keyA]));
  });
});
