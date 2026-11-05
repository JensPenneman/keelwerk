import { hkdfSync } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import { deriveFieldKey } from '../keys/derive-field-key.ts';
import { eqTag } from './eq-tag.ts';
import { indexRootKey } from './index-root-key.ts';

const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex');
const scopeKey = new Uint8Array(32).fill(7);

/** A key service whose scope key is fixed: HKDF-SHA-256 with an empty salt over it. */
const keys = {
  derive: (_scope: unknown, info: string, length: number): Promise<Uint8Array> =>
    Promise.resolve(
      new Uint8Array(
        hkdfSync('sha256', scopeKey, new Uint8Array(), new TextEncoder().encode(info), length),
      ),
    ),
};
const scope = { level: 'tenant', backendId: 'b1', tenantId: 't1' } as const;

describe('blind index known answers', () => {
  test('the root key, the field key and the tag are fixed for a fixed scope key and value', async () => {
    const root = await indexRootKey(keys, scope, 1);
    const fieldKey = deriveFieldKey(root, {
      entity: 'crm.person',
      field: 'email',
      capability: 'eq',
      normaliser: 'email@1',
      parameters: { bits: 128 },
    });
    expect(hex(root)).toBe('bcbcfde970492825a3daffc2d4b6bf71dd880131140a827bf1f007c4f4445232');
    expect(hex(fieldKey)).toBe('881675a7010ed8269bc6b80f3fd48b6a143fd214e378107b33051bf956dd7556');
    expect(hex(eqTag(fieldKey, 'jens@jenspenneman.com'))).toBe('12ff1b52e59b21dca6384b6fbd226158');
    expect(hex(eqTag(fieldKey, 'jens@jenspenneman.com', 20))).toBe('12ff10');
  });
});
