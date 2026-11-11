import { describe, expect, test } from 'vitest';
import type { Registry } from '../registry/registry.ts';
import type { VersionChangeEntry } from '../registry/version-change-entry.ts';
import type { EntityPositions } from './entity-positions.ts';
import { headNameIssues } from './head-name-issues.ts';

const relations: Readonly<Record<string, Readonly<Record<string, { target: string }>>>> = {
  shelf: { racks: { target: 'rack' } },
  rack: { items: { target: 'item' } },
};
const registry = {
  entities: new Map(
    ['shelf', 'rack', 'item'].map((ref) => [
      ref,
      { ref, descriptor: { relations: relations[ref] ?? {} } },
    ]),
  ),
} as unknown as Registry;
const rename = {
  surface: [{ entity: 'item', field: 'label', renamedFrom: 'title' }],
} as unknown as VersionChangeEntry;
const positions: EntityPositions = {
  entity: 'shelf',
  inputRows: [],
  outputRows: [],
  selections: [],
  sorts: [],
  filters: [['filter']],
};
const refusal = 'is not a field of this shape';

describe('headNameIssues: a head name in a filter through relations', () => {
  test('two hops of nested relation objects name the key of the head field', () => {
    const value = { filter: { racks: { items: { some: { label: 'x', title: 'old' } } } } };
    expect(headNameIssues(registry, [rename], positions, value)).toEqual([
      { path: ['filter', 'racks', 'items', 'some', 'label'], message: refusal },
    ]);
  });

  test('a dotted relation key reaches the same field', () => {
    const value = { filter: { 'racks.items': { none: { or: [{ label: 'x' }] } } } };
    expect(headNameIssues(registry, [rename], positions, value)).toEqual([
      { path: ['filter', 'racks.items', 'none', 'or', 0, 'label'], message: refusal },
    ]);
  });

  test('the older name and the fields of other entities pass', () => {
    const value = { filter: { name: 'x', racks: { items: { some: { title: 'x' } }, name: 'r' } } };
    expect(headNameIssues(registry, [rename], positions, value)).toEqual([]);
  });
});
