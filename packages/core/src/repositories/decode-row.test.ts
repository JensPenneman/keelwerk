import { describe, expect, test } from 'vitest';
import { fieldDescriptor } from '../../test/authorization/fixtures.ts';
import { secretRefOwner } from '../keys/secret-ref-owner.ts';
import type { EntityEntry } from '../registry/entity-entry.ts';
import type { EntityDescriptor } from '../storage/entity-descriptor.ts';
import { decodeRow } from './decode-row.ts';

const entry = {
  ref: 'auth.credential',
  module: 'auth',
  name: 'credential',
  origin: { note: 'audit', badge: 'audit' },
  descriptor: {
    fields: {
      label: fieldDescriptor('string'),
      passwordHash: fieldDescriptor('verifier'),
      internal: fieldDescriptor('string', { hidden: true }),
      note: fieldDescriptor('string', { hidden: true }),
      badge: fieldDescriptor('string'),
      apiSecret: fieldDescriptor('secret'),
    },
  } as unknown as EntityDescriptor,
} as unknown as EntityEntry;

const row = {
  id: 'c1',
  version: 1,
  label: 'laptop',
  passwordHash: '$argon2id$x',
  internal: 'i',
  note: 'n',
  badge: 'gold',
  apiSecret: {
    keyId: 'k1',
    nonce: new Uint8Array([1, 2, 3]),
    ciphertext: new Uint8Array([4, 5, 6]),
  },
  $masked: ['label'],
};

describe('decodeRow', () => {
  test('the owning module keeps hidden and verifier fields and reads secrets as references', () => {
    const decoded = decodeRow(entry, row, 'auth');
    expect(decoded).toMatchObject({
      label: 'laptop',
      passwordHash: '$argon2id$x',
      internal: 'i',
      apiSecret: { ref: 'kwv1.k1.AQID.BAUG' },
      $masked: ['label'],
    });
    expect(decoded).not.toHaveProperty('note');
  });

  test('another module does not read hidden, secret or verifier fields', () => {
    const decoded = decodeRow(entry, row, 'accounts');
    expect(Object.keys(decoded).sort()).toEqual(['$masked', 'id', 'label', 'version']);
  });

  test('the secret reference is stamped with its owner and the stamp does not enumerate', () => {
    const { apiSecret } = decodeRow(entry, row, 'auth') as { apiSecret: object };
    expect(Reflect.get(apiSecret, secretRefOwner)).toBe('auth');
    expect(Object.keys(apiSecret)).toEqual(['ref']);
    expect(JSON.stringify(apiSecret)).toBe('{"ref":"kwv1.k1.AQID.BAUG"}');
  });

  test('the contributor of a field reads it when hidden', () => {
    expect(decodeRow(entry, row, 'audit')).toHaveProperty('note', 'n');
  });

  test('a field another module contributes is not part of the view, hidden or not', () => {
    expect(decodeRow(entry, row, 'audit')).toHaveProperty('badge', 'gold');
    expect(decodeRow(entry, row, 'auth')).not.toHaveProperty('badge');
    expect(decodeRow(entry, row, 'accounts')).not.toHaveProperty('badge');
  });
});
