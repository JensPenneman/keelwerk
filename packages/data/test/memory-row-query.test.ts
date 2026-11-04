import type { StorageRow } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import { failure } from './support/failure.ts';
import { id } from './support/id.ts';
import { openMemory } from './support/memory-fixture.ts';
import { note } from './support/note.ts';
import { noteRow } from './support/note-row.ts';
import { tenantScope } from './support/tenant-scope.ts';

async function seedNotes(
  memory: ReturnType<typeof openMemory>,
  rows: readonly StorageRow[],
): Promise<void> {
  await memory.run(tenantScope, (unit) => unit.rows.insert(note, rows));
}

describe('conditions', () => {
  test('decimals compare by value, ne and nin are null-safe, strings by code point', async () => {
    const memory = openMemory();
    await seedNotes(memory, [
      noteRow(1, { price: '10.50', title: '\u{1F600}' }),
      noteRow(2, { price: '9' }),
      noteRow(3, { title: '～' }),
    ]);
    const idsOf = (condition: object): Promise<unknown[]> =>
      memory.read(tenantScope, async (unit) =>
        (await unit.rows.find(note, { where: condition as never })).rows.map((row) => row.id),
      );
    expect(await idsOf({ op: 'gt', field: 'price', value: '9.9' })).toEqual([id(1)]);
    expect(await idsOf({ op: 'eq', field: 'price', value: '9.00' })).toEqual([id(2)]);
    expect(await idsOf({ op: 'ne', field: 'price', value: '9' })).toEqual([id(1), id(3)]);
    expect(await idsOf({ op: 'nin', field: 'price', value: ['9'] })).toEqual([id(1), id(3)]);
    expect(await idsOf({ op: 'gt', field: 'title', value: '～' })).toEqual([id(1)]);
  });

  test('a filter the compiled form would refuse is refused', async () => {
    const memory = openMemory();
    await seedNotes(memory, [noteRow(1, {})]);
    const refused = (condition: object): Promise<{ kind: string; code: string }> =>
      failure(
        memory.read(tenantScope, (unit) => unit.rows.find(note, { where: condition as never })),
      );
    expect((await refused({ op: 'eq', field: 'data', value: 1 })).code).toBe(
      'core.malformed_request',
    );
    expect((await refused({ op: 'eq', field: 'nope', value: 1 })).code).toBe(
      'core.malformed_request',
    );
    expect((await refused({ op: 'eq', field: 'secret', value: 1 })).code).toBe(
      'core.malformed_request',
    );
    expect(await refused({ op: 'startsWith', field: 'email', value: 'a' })).toEqual({
      kind: 'unsupported',
      code: 'core.personal_operator',
    });
    expect((await refused({ op: 'some', relation: 'nope', where: { op: 'never' } })).code).toBe(
      'core.malformed_request',
    );
  });

  test('set and list fields answer contains and isNull', async () => {
    const memory = openMemory();
    await seedNotes(memory, [
      noteRow(1, { tags: new Set(['a', 'b']), labels: ['x'] }),
      noteRow(2, {}),
    ]);
    const idsOf = (condition: object): Promise<unknown[]> =>
      memory.read(tenantScope, async (unit) =>
        (await unit.rows.find(note, { where: condition as never })).rows.map((row) => row.id),
      );
    expect(await idsOf({ op: 'contains', field: 'tags', value: 'b' })).toEqual([id(1)]);
    expect(await idsOf({ op: 'contains', field: 'labels', value: 'x' })).toEqual([id(1)]);
    expect(await idsOf({ op: 'isNull', field: 'tags', value: true })).toEqual([id(2)]);
  });
});
