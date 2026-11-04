import type { Condition, StorageRow } from '@keelwerk/core';
import { isKeelwerkError } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import { id } from '../support/id.ts';
import { member } from '../support/member.ts';
import { note } from '../support/note.ts';
import { noteRow } from '../support/note-row.ts';
import { stamp } from '../support/stamp.ts';
import type { StoreFixture } from '../support/store-fixture.ts';
import { storeSuite } from '../support/store-suite.ts';
import { team } from '../support/team.ts';
import { tenantScope } from '../support/tenant-scope.ts';

const memory = storeSuite();

async function _failure(work: Promise<unknown>): Promise<{ kind: string; code: string }> {
  try {
    await work;
  } catch (error) {
    if (isKeelwerkError(error)) return { kind: error.kind, code: error.code };
    throw error;
  }
  throw new Error('expected a KeelwerkError');
}

async function _seedNotes(memory: StoreFixture, rows: readonly StorageRow[]): Promise<void> {
  await memory.run(tenantScope, (unit) => unit.rows.insert(note, rows));
}

describe('relation quantifiers (14.3.4)', () => {
  const members = (teamId: string, roles: readonly (string | null)[], from: number): StorageRow[] =>
    roles.map((role, index) =>
      noteRow(from + index, {
        teamId,
        userId: id(500 + from + index),
        ...(role === null ? {} : { role }),
      }),
    );

  async function seedTeams(memory: StoreFixture): Promise<void> {
    await memory.run(tenantScope, async (unit) => {
      await unit.rows.insert(team, [
        noteRow(1, { name: 'full' }),
        noteRow(2, { name: 'empty' }),
        noteRow(3, { name: 'mixed' }),
      ]);
      await unit.rows.insert(member, [
        ...members(id(1), ['admin', 'admin'], 11),
        ...members(id(3), ['admin', 'guest'], 21),
      ]);
    });
  }

  const names = (memory: StoreFixture, condition: object): Promise<unknown[]> =>
    memory.read(tenantScope, async (unit) =>
      (
        await unit.rows.find(team, {
          where: condition as never,
          sort: [{ field: 'name', direction: 'asc' }],
        })
      ).rows.map((row) => row.name),
    );
  const admin: Condition = { op: 'eq', field: 'role', value: 'admin' };

  test('some, none and every; every holds for an empty relation', async () => {
    await seedTeams(memory);
    expect(await names(memory, { op: 'some', relation: 'members', where: admin })).toEqual([
      'full',
      'mixed',
    ]);
    expect(await names(memory, { op: 'none', relation: 'members', where: admin })).toEqual([
      'empty',
    ]);
    expect(await names(memory, { op: 'every', relation: 'members', where: admin })).toEqual([
      'empty',
      'full',
    ]);
  });

  test('archived related rows are ignored', async () => {
    await seedTeams(memory);
    await memory.run(tenantScope, (unit) =>
      unit.rows.update(member, [
        {
          id: id(21),
          expectedVersion: 1,
          values: noteRow(21, {
            version: 2,
            teamId: id(3),
            userId: id(521),
            role: 'admin',
            archivedAt: stamp,
          }),
        },
        {
          id: id(22),
          expectedVersion: 1,
          values: noteRow(22, {
            version: 2,
            teamId: id(3),
            userId: id(522),
            role: 'guest',
            archivedAt: stamp,
          }),
        },
      ]),
    );
    expect(await names(memory, { op: 'some', relation: 'members', where: admin })).toEqual([
      'full',
    ]);
    expect(await names(memory, { op: 'every', relation: 'members', where: admin })).toEqual([
      'empty',
      'full',
      'mixed',
    ]);
  });

  test('`is` follows a reference and is false on an absent one; a hop path nests', async () => {
    await seedTeams(memory);
    const memberNames = (condition: object): Promise<unknown[]> =>
      memory.read(tenantScope, async (unit) =>
        (await unit.rows.find(member, { where: condition as never })).rows.map((row) => row.id),
      );
    expect(
      await memberNames({
        op: 'is',
        relation: 'team',
        where: { op: 'eq', field: 'name', value: 'mixed' },
      }),
    ).toEqual([id(21), id(22)]);
    expect(
      await memberNames({
        op: 'is',
        relation: 'team',
        where: { op: 'eq', field: 'name', value: 'none' },
      }),
    ).toEqual([]);
    const viaTeam = await memberNames({
      op: 'some',
      relation: 'team.members',
      where: { op: 'eq', field: 'role', value: 'guest' },
    });
    expect(viaTeam).toEqual([id(21), id(22)]);
    await memory.run(tenantScope, (unit) =>
      unit.rows.insert(note, [noteRow(40, { teamId: id(77) })]),
    );
    const orphan = await memory.read(
      tenantScope,
      async (unit) =>
        (
          await unit.rows.find(note, {
            where: { op: 'is', relation: 'team', where: { op: 'never' } } as never,
          })
        ).rows.length,
    );
    expect(orphan).toBe(0);
  });

  test('matching answers for the named rows, archived ones included', async () => {
    await seedTeams(memory);
    const matched = await memory.run(tenantScope, (unit) =>
      unit.rows.matching(team, [id(1), id(2), id(3), id(99)], {
        op: 'some',
        relation: 'members',
        where: admin,
      }),
    );
    expect([...matched].sort()).toEqual([id(1), id(3)]);
  });
});
