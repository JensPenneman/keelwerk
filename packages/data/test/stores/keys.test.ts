import { expect, test } from 'vitest';
import { id } from '../support/id.ts';
import { storeSuite } from '../support/store-suite.ts';
import { tenantScope } from '../support/tenant-scope.ts';
import { tenantTwo } from '../support/tenant-two.ts';

const memory = storeSuite();

const subject = id(77);

test('a data key is created on first use only when asked, and stays the same afterwards', async () => {
  expect(
    await memory.run(tenantScope, (unit) => unit.keys.dataKey(subject, { create: false })),
  ).toBeUndefined();
  const created = await memory.run(tenantScope, (unit) =>
    unit.keys.dataKey(subject, { create: true }),
  );
  expect(created?.material).toHaveLength(32);
  const again = await memory.read(tenantScope, (unit) =>
    unit.keys.dataKey(subject, { create: false }),
  );
  expect(again).toEqual(created);
  expect(
    await memory.read(tenantScope, async (unit) => unit.keys.keyById(created?.id ?? '')),
  ).toEqual(created);
});

test('keys belong to their scope and the material handed out is a copy', async () => {
  const created = await memory.run(tenantScope, (unit) =>
    unit.keys.dataKey(subject, { create: true }),
  );
  created?.material.fill(0);
  const again = await memory.read(tenantScope, (unit) =>
    unit.keys.dataKey(subject, { create: false }),
  );
  expect(again?.material.some((byte) => byte !== 0)).toBe(true);
  expect(
    await memory.read(tenantTwo, (unit) => unit.keys.dataKey(subject, { create: false })),
  ).toBeUndefined();
  expect(
    await memory.read(tenantTwo, (unit) => unit.keys.keyById(created?.id ?? '')),
  ).toBeUndefined();
});

test('shred destroys every version, leaves no key to create again, and reports the ids', async () => {
  const key = await memory.run(tenantScope, (unit) => unit.keys.dataKey(subject, { create: true }));
  const shredded = await memory.run(tenantScope, (unit) => unit.keys.shred(subject));
  expect(shredded.keyIds).toEqual([key?.id]);
  expect(
    await memory.read(tenantScope, (unit) => unit.keys.dataKey(subject, { create: false })),
  ).toBeUndefined();
  expect(
    await memory.run(tenantScope, (unit) => unit.keys.dataKey(subject, { create: true })),
  ).toBeUndefined();
  expect(
    await memory.read(tenantScope, (unit) => unit.keys.keyById(key?.id ?? '')),
  ).toBeUndefined();
  expect((await memory.run(tenantScope, (unit) => unit.keys.shred(subject))).keyIds).toEqual([]);
});

test("wrap and unwrap round-trip a key under the subject's data key, and shredding makes it unreadable", async () => {
  const blobKey = crypto.getRandomValues(new Uint8Array(32));
  const wrapped = await memory.run(tenantScope, (unit) => unit.keys.wrap(subject, blobKey));
  expect(wrapped).not.toEqual(blobKey);
  expect(await memory.read(tenantScope, (unit) => unit.keys.unwrap(subject, wrapped))).toEqual(
    blobKey,
  );
  expect(
    await memory.read(tenantScope, (unit) => unit.keys.unwrap(id(78), wrapped)),
  ).toBeUndefined();
  await memory.run(tenantScope, (unit) => unit.keys.shred(subject));
  expect(
    await memory.read(tenantScope, (unit) => unit.keys.unwrap(subject, wrapped)),
  ).toBeUndefined();
  await expect(
    memory.run(tenantScope, (unit) => unit.keys.wrap(subject, blobKey)),
  ).rejects.toMatchObject({ kind: 'not_found' });
});

test('subject references are kept once and listed in order after a mark', async () => {
  const refs = [
    { type: 'b.entity', id: id(2) },
    { type: 'a.entity', id: id(9) },
    { type: 'a.entity', id: id(1) },
  ];
  await memory.run(tenantScope, async (unit) => {
    await unit.keys.addRefs(subject, refs);
    await unit.keys.addRefs(subject, [refs[0] ?? { type: '', id: '' }]);
    await unit.keys.addRefs(id(78), [{ type: 'z.entity', id: id(3) }]);
  });
  const listed = (
    after: { type: string; id: string } | null,
    limit: number,
  ): Promise<readonly unknown[]> =>
    memory.read(tenantScope, (unit) => unit.keys.refs(subject, after, limit));
  expect(await listed(null, 10)).toEqual([
    { type: 'a.entity', id: id(1) },
    { type: 'a.entity', id: id(9) },
    { type: 'b.entity', id: id(2) },
  ]);
  expect(await listed({ type: 'a.entity', id: id(1) }, 1)).toEqual([
    { type: 'a.entity', id: id(9) },
  ]);
  expect(await listed({ type: 'b.entity', id: id(2) }, 5)).toEqual([]);
});

test('a sealed value opens with its own key and is gone once the key is destroyed', async () => {
  const plain = new TextEncoder().encode('hash');
  const binding = { entity: 'auth.credential', id: id(5), field: 'verifier' };
  const sealed = await memory.run(tenantScope, (unit) => unit.keys.sealValue(binding, plain));
  expect(sealed.nonce).toHaveLength(12);
  expect(sealed.ciphertext).toHaveLength(plain.length + 16);
  expect(await memory.read(tenantScope, (unit) => unit.keys.openValue(sealed))).toEqual(plain);
  expect(await memory.read(tenantTwo, (unit) => unit.keys.openValue(sealed))).toBeUndefined();
  await memory.run(tenantScope, (unit) => unit.keys.destroyValueKey(sealed.keyId));
  expect(await memory.read(tenantScope, (unit) => unit.keys.openValue(sealed))).toBeUndefined();
  await memory.run(tenantScope, (unit) => unit.keys.destroyValueKey(sealed.keyId));
});

test('a tampered sealed value does not open', async () => {
  const sealed = await memory.run(tenantScope, (unit) =>
    unit.keys.sealValue({ entity: 'e', id: id(1), field: 'f' }, new Uint8Array([1, 2, 3])),
  );
  const tampered = {
    ...sealed,
    ciphertext: sealed.ciphertext.map((byte, i) => (i === 0 ? byte ^ 1 : byte)),
  };
  await expect(memory.read(tenantScope, (unit) => unit.keys.openValue(tampered))).rejects.toThrow();
});

test('a read-only unit creates nothing', async () => {
  await expect(
    memory.read(tenantScope, (unit) => unit.keys.dataKey(subject, { create: true })),
  ).rejects.toMatchObject({ kind: 'internal' });
});
