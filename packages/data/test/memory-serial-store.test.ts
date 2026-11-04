import { expect, test } from 'vitest';
import { entityOf } from './support/entity-of.ts';
import { failure } from './support/failure.ts';
import { fieldOf } from './support/field-of.ts';
import { openMemory } from './support/memory-fixture.ts';
import { note } from './support/note.ts';
import { tenantScope } from './support/tenant-scope.ts';
import { tenantTwo } from './support/tenant-two.ts';

const message = entityOf('app.message', 'app__message', 'tenant', {
  uid: fieldOf('serial', 'uid', { constraints: { per: 'mailboxId' } }),
});

test('values start at 1 and rise by the count taken, per partition', async () => {
  const memory = openMemory([message]);
  const taken = await memory.run(tenantScope, async (unit) => [
    await unit.serials.next(message, 'uid', ['box-a']),
    await unit.serials.next(message, 'uid', ['box-a'], 3),
    await unit.serials.next(message, 'uid', ['box-a']),
    await unit.serials.next(message, 'uid', ['box-b']),
  ]);
  expect(taken).toEqual([1n, 2n, 5n, 1n]);
});

test('values are strictly ascending across units and never reused after a rollback', async () => {
  const memory = openMemory([message]);
  await memory.run(tenantScope, (unit) => unit.serials.next(message, 'uid', ['a']));
  await memory
    .run(tenantScope, async (unit) => {
      await unit.serials.next(message, 'uid', ['a'], 5);
      throw new Error('boom');
    })
    .catch(() => undefined);
  expect(await memory.run(tenantScope, (unit) => unit.serials.next(message, 'uid', ['a']))).toBe(
    2n,
  );
});

test('a savepoint that fails gives its values back', async () => {
  const memory = openMemory([message]);
  const next = await memory.run(tenantScope, async (unit) => {
    await unit.nested((inner) => inner.serials.next(message, 'uid', [])).catch(() => undefined);
    await unit
      .nested(async (inner) => {
        await inner.serials.next(message, 'uid', [], 4);
        throw new Error('undo');
      })
      .catch(() => undefined);
    return unit.serials.next(message, 'uid', []);
  });
  expect(next).toBe(2n);
});

test('partitions are per scope; integer and bigint partition values are the same partition', async () => {
  const memory = openMemory([message]);
  await memory.run(tenantScope, (unit) => unit.serials.next(message, 'uid', [1]));
  expect(await memory.run(tenantScope, (unit) => unit.serials.next(message, 'uid', [1n]))).toBe(2n);
  expect(await memory.run(tenantTwo, (unit) => unit.serials.next(message, 'uid', [1]))).toBe(1n);
});

test('a field that is not a serial, or a count below one, is refused; read-only units cannot allocate', async () => {
  const memory = openMemory([message]);
  expect(
    (await failure(memory.run(tenantScope, (unit) => unit.serials.next(note, 'title', [])))).code,
  ).toBe('core.malformed_request');
  expect(
    (await failure(memory.run(tenantScope, (unit) => unit.serials.next(message, 'uid', [], 0))))
      .code,
  ).toBe('core.malformed_request');
  expect(
    (await failure(memory.read(tenantScope, (unit) => unit.serials.next(message, 'uid', [])))).kind,
  ).toBe('internal');
});
