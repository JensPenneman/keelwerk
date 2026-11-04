import { encodeAad } from '@keelwerk/core';
import { expect, test } from 'vitest';
import { aesKeyWrapper } from '../../src/conformance/index.ts';
import { sqlOpen } from '../../src/sql/sql-open.ts';
import { storeSuite } from '../support/store-suite.ts';
import { tenantScope } from '../support/tenant-scope.ts';

const store = storeSuite();
const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex');
const wrappingKey = new Uint8Array(32).fill(7);

test('associated data is parts with 4-byte big-endian length prefixes (golden bytes)', () => {
  expect(hex(encodeAad(['ab', new Uint8Array([1, 2, 3]), '']))).toBe(
    '00000002616200000003010203' + '00000000',
  );
});

test('the test key wrapper is nonce then ciphertext under scopeId and context as length-prefixed parts', async () => {
  const wrapper = aesKeyWrapper(wrappingKey);
  const plain = new Uint8Array([9, 8, 7]);
  const wrapped = await wrapper.wrap('scope-1', plain, new Uint8Array([5]));
  expect(wrapped).toHaveLength(12 + plain.length + 16);
  expect(hex(encodeAad(['scope-1', new Uint8Array([5])]))).toBe(
    '0000000773636f70652d3100000001' + '05',
  );
  const opened = await sqlOpen(
    wrappingKey,
    wrapped.subarray(0, 12),
    wrapped.subarray(12),
    encodeAad(['scope-1', new Uint8Array([5])]),
  );
  expect(opened).toEqual(plain);
  await expect(wrapper.unwrap('scope-2', wrapped, new Uint8Array([5]))).rejects.toBeDefined();
});

test('a wrapped key is: 1-byte id length, the id, a 12-byte nonce, the ciphertext, sealed under the data key with the id as associated data', async () => {
  const subject = '00000000-0000-4000-8000-000000000077';
  const blobKey = new Uint8Array(32).fill(3);
  const { wrapped, material, keyId } = await store.run(tenantScope, async (unit) => {
    const sealed = await unit.keys.wrap(subject, blobKey);
    const data = await unit.keys.dataKey(subject, { create: false });
    return { wrapped: sealed, material: data?.material ?? new Uint8Array(), keyId: data?.id ?? '' };
  });
  expect(wrapped[0]).toBe(36);
  expect(new TextDecoder().decode(wrapped.subarray(1, 37))).toBe(keyId);
  expect(wrapped).toHaveLength(1 + 36 + 12 + 32 + 16);
  const opened = await sqlOpen(
    material,
    wrapped.subarray(37, 49),
    wrapped.subarray(49),
    new TextEncoder().encode(keyId),
  );
  expect(opened).toEqual(blobKey);
});

test('a value key bundle is the 32-byte key then the length-prefixed entity, id and field', async () => {
  const binding = { entity: 'app.note', id: '00000000-0000-4000-8000-000000000001', field: 'body' };
  const sealed = await store.run(tenantScope, (unit) =>
    unit.keys.sealValue(binding, new TextEncoder().encode('x')),
  );
  const stored = await store.read(tenantScope, (unit) =>
    unit.db
      .selectFrom('app.kw_value_keys')
      .select('wrapped')
      .where('key_id', '=', sealed.keyId)
      .executeTakeFirstOrThrow(),
  );
  const wrapped = new Uint8Array(stored.wrapped as Uint8Array);
  const bundle = await aesKeyWrapper(wrappingKey).unwrap(
    tenantScope.level === 'tenant' ? tenantScope.tenantId : '',
    wrapped,
    new TextEncoder().encode(sealed.keyId),
  );
  expect(bundle).toHaveLength(32 + 4 + 8 + 4 + 36 + 4 + 4);
  expect(hex(bundle.subarray(32))).toBe(
    `00000008${hex(new TextEncoder().encode(binding.entity))}00000024${hex(new TextEncoder().encode(binding.id))}00000004${hex(new TextEncoder().encode(binding.field))}`,
  );
});
