import type { EntityDescriptor, StorageRow } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import { account } from './support/account.ts';
import { backendScope } from './support/backend-scope.ts';
import { deploymentScope } from './support/deployment-scope.ts';
import { failure } from './support/failure.ts';
import { global } from './support/global.ts';
import { id } from './support/id.ts';
import { openMemory } from './support/memory-fixture.ts';
import { namespaceScope } from './support/namespace-scope.ts';
import { newEvent } from './support/new-event.ts';
import { note } from './support/note.ts';
import { noteRow } from './support/note-row.ts';
import { setting } from './support/setting.ts';
import { tenantScope } from './support/tenant-scope.ts';
import { tenantTwo } from './support/tenant-two.ts';

const titles = (rows: readonly StorageRow[]): unknown[] => rows.map((row) => row.title);

async function seedNotes(
  memory: ReturnType<typeof openMemory>,
  rows: readonly StorageRow[],
): Promise<void> {
  await memory.run(tenantScope, (unit) => unit.rows.insert(note, rows));
}

describe('scopes', () => {
  test('a unit sees only its own scope', async () => {
    const memory = openMemory();
    await seedNotes(memory, [noteRow(1, { title: 'one' })]);
    await memory.run(tenantTwo, (unit) => unit.rows.insert(note, [noteRow(1, { title: 'two' })]));
    expect(
      titles((await memory.read(tenantScope, (unit) => unit.rows.find(note, {}))).rows),
    ).toEqual(['one']);
    expect(titles((await memory.read(tenantTwo, (unit) => unit.rows.find(note, {}))).rows)).toEqual(
      ['two'],
    );
    expect(await memory.read(tenantTwo, (unit) => unit.rows.exists(note, [id(1)]))).toEqual(
      new Set([id(1)]),
    );
    await memory.run(tenantTwo, (unit) => unit.rows.purge(note, [id(1)]));
    expect(await memory.read(tenantScope, (unit) => unit.rows.count(note))).toBe(1);
  });

  test('backend and deployment units are refused on tenant entities and the other way round', async () => {
    const memory = openMemory([setting]);
    const refusedOn = async (
      scope: Parameters<typeof memory.read>[0],
      entity: EntityDescriptor,
    ): Promise<{ kind: string; code: string }> =>
      failure(memory.read(scope, (unit) => unit.rows.find(entity, {})));
    const forbidden = { kind: 'forbidden', code: 'core.forbidden' };
    expect(await refusedOn(backendScope, note)).toEqual(forbidden);
    expect(await refusedOn(deploymentScope, note)).toEqual(forbidden);
    expect(await refusedOn(tenantScope, setting)).toEqual(forbidden);
    expect(await refusedOn(tenantScope, global)).toEqual(forbidden);
    expect(await refusedOn(namespaceScope, note)).toEqual(forbidden);
    await memory.run(backendScope, (unit) =>
      unit.rows.insert(setting, [noteRow(1, { name: 's' })]),
    );
    await memory.run(deploymentScope, (unit) =>
      unit.rows.insert(global, [noteRow(1, { name: 'g' })]),
    );
    expect(await memory.read(backendScope, (unit) => unit.rows.count(setting))).toBe(1);
  });

  test("a row that names another tenant is refused, one that names the unit's tenant is stored", async () => {
    const memory = openMemory();
    const other = await failure(seedNotes(memory, [noteRow(1, { tenantId: id(5) })]));
    expect(other).toEqual({ kind: 'forbidden', code: 'core.forbidden' });
    await seedNotes(memory, [
      noteRow(2, { tenantId: tenantScope.level === 'tenant' ? tenantScope.tenantId : '' }),
    ]);
    expect(await memory.read(tenantScope, (unit) => unit.rows.count(note))).toBe(1);
  });

  test('a relation cannot reach an entity of another tenancy', async () => {
    const reaching: EntityDescriptor = {
      ...setting,
      relations: {
        globals: { kind: 'many', target: 'app.global', by: 'id', to: 'id', contributedBy: null },
      },
    };
    const memory = openMemory([reaching, global]);
    const refused = await failure(
      memory.read(backendScope, (unit) =>
        unit.rows.find(reaching, {
          where: { op: 'some', relation: 'globals', where: { op: 'never' } },
        }),
      ),
    );
    expect(refused).toEqual({ kind: 'forbidden', code: 'core.forbidden' });
  });

  test('a read-only unit refuses writes', async () => {
    const memory = openMemory();
    const refused = await failure(
      memory.read(tenantScope, (unit) => unit.rows.insert(note, [noteRow(1, {})])),
    );
    expect(refused.kind).toBe('internal');
  });
});

describe('positioned reads (S-19)', () => {
  test('the position is the last committed one of the scope, 0 before any', async () => {
    const memory = openMemory();
    await seedNotes(memory, [noteRow(1, {})]);
    const empty = await memory.read(tenantScope, (unit) =>
      unit.rows.find(note, { positioned: true }),
    );
    expect(empty.position).toBe(0n);
    await memory.run(tenantScope, async (unit) => {
      await unit.events.append([
        {
          stream: { type: 'app.note', id: id(1) },
          expectedVersion: 0,
          partition: null,
          events: [newEvent(1), newEvent(2)],
        },
      ]);
      const inside = await unit.rows.find(note, { positioned: true });
      expect(inside.position).toBe(0n);
    });
    const after = await memory.read(tenantScope, (unit) =>
      unit.rows.find(note, { positioned: true, where: { op: 'never' } }),
    );
    expect([after.position, after.rows.length]).toEqual([2n, 0]);
    const other = await memory.read(tenantTwo, (unit) =>
      unit.rows.find(note, { positioned: true }),
    );
    expect(other.position).toBe(0n);
    const locked = await failure(
      memory.read(tenantScope, (unit) =>
        unit.rows.find(note, { positioned: true, forUpdate: true }),
      ),
    );
    expect(locked.code).toBe('core.malformed_request');
  });
});

describe('search (capability search: naive)', () => {
  test('every word must occur, ignoring case; a plan narrows it', async () => {
    const memory = openMemory([account]);
    await memory.run(tenantScope, (unit) =>
      unit.rows.insert(account, [
        noteRow(1, { handle: 'Ann Lee' }),
        noteRow(2, { handle: 'annette' }),
        noteRow(3, { handle: 'bob' }),
      ]),
    );
    const found = await memory.read(tenantScope, async (unit) =>
      unit.rows.search?.(account, { index: 'text', match: { text: 'ANN lee' } }),
    );
    expect(found?.rows.map((row) => row.id)).toEqual([id(1)]);
    const narrowed = await memory.read(tenantScope, async (unit) =>
      unit.rows.search?.(account, {
        index: 'text',
        match: { text: 'ann' },
        where: { op: 'eq', field: 'handle', value: 'annette' },
      }),
    );
    expect(narrowed?.rows.map((row) => row.id)).toEqual([id(2)]);
  });
});
