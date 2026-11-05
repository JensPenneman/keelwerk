import type { EntityEntry, TrackSnapshot } from '@keelwerk/core';
import {
  buildRegistry,
  defineApp,
  defineEntity,
  defineModule,
  defineModuleBase,
  field,
} from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import { buildTrackSnapshot } from '../../src/index.ts';

function entryOf(
  queries: readonly ('eq' | 'prefix')[],
  declared: boolean,
  unique: boolean,
): EntityEntry {
  const person = defineEntity({
    prefix: 'prs',
    tenancy: 'backend',
    dataSubject: 'owner',
    fields: {
      owner: field.subject(),
      email: field
        .string({ maxLength: 120 })
        .personal({ queries: [...queries], normalize: 'email' }),
    },
    indexes: declared ? [{ fields: ['email'], unique }] : [],
  });
  const people = defineModule(
    defineModuleBase({ id: 'people', version: '0.1.0', entities: { person } } as never),
    {},
  ) as never;
  const registry = buildRegistry({
    kind: 'app',
    id: 'people-app',
    modules: [...defineApp({ id: 'seed', modules: [] }).modules, people],
    execution: {},
    appActions: {},
    authorization: {},
    policies: {},
    api: null,
  });
  const found = registry.entities.get('people.person');
  if (found === undefined) throw new Error('the registry built no people.person');
  return found;
}

describe('declared indexes on personal fields', () => {
  test('a unique declared index lands on the blind-index equality column, never the ciphertext', () => {
    const snapshot = buildTrackSnapshot([entryOf(['eq', 'prefix'], true, true)]).get(
      'people',
    ) as TrackSnapshot;
    const indexes = snapshot.tables[0]?.indexes ?? [];
    const declared = indexes.find((index) => index.unique);
    expect(declared?.columns).toEqual(['backend_id', 'email__eq']);
    expect(indexes.some((index) => index.columns.includes('email'))).toBe(false);
  });

  test('a declared index on a personal field without an eq index is refused by name', () => {
    const entry = entryOf(['eq'], true, true);
    const withoutEq = { ...entry, descriptor: { ...entry.descriptor, derivedIndexes: {} } };
    expect(() => buildTrackSnapshot([withoutEq])).toThrow(
      /people\.person: index .* names the personal field email, which has no eq index/,
    );
  });
});
