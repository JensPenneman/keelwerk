import { describe, expect, test } from 'vitest';
import type { EntityDescriptor } from '../storage/entity-descriptor.ts';
import type { FieldDescriptor } from '../storage/field-descriptor.ts';
import type { IndexDescriptor } from '../storage/index-descriptor.ts';
import { checkDataSubjectIndexes } from './check-data-subject-indexes.ts';
import type { EntityEntry } from './entity-entry.ts';

function fieldOf(over: Partial<FieldDescriptor> = {}, target?: string): FieldDescriptor {
  return {
    kind: target === undefined ? 'subject' : 'ref',
    indexed: false,
    unique: false,
    ref: target === undefined ? null : { entity: target, foreignKey: true },
    ...over,
  } as FieldDescriptor;
}

function entryOf(
  ref: string,
  dataSubject: string | null,
  fields: Record<string, FieldDescriptor>,
  indexes: readonly IndexDescriptor[] = [],
): EntityEntry {
  const [module = ''] = ref.split('.');
  return {
    ref,
    module,
    descriptor: {
      ref,
      module,
      tenancy: 'tenant',
      dataSubject,
      fields,
      indexes,
    } as EntityDescriptor,
  } as EntityEntry;
}

const entities = (...entries: EntityEntry[]) => new Map(entries.map((entry) => [entry.ref, entry]));
const codes = (problems: ReturnType<typeof checkDataSubjectIndexes>) =>
  problems.map((problem) => `${problem.code}:${problem.severity}:${problem.ref}`);

describe('dataSubjectUnindexed: the fields an erasure looks rows up by (14.7.5)', () => {
  test('a data-subject field without an index is a warning, one with .index() or a plain declared index is not', () => {
    const bare = entryOf('a.bare', 'owner', { owner: fieldOf() });
    const marked = entryOf('a.marked', 'owner', { owner: fieldOf({ indexed: true }) });
    const declared = entryOf('a.declared', 'owner', { owner: fieldOf() }, [
      { name: 'i', fields: ['owner', 'at'], unique: false, where: null },
    ]);
    expect(codes(checkDataSubjectIndexes(entities(bare, marked, declared)))).toEqual([
      'dataSubjectUnindexed:warning:a.bare',
    ]);
  });

  test('a unique field and a partial index do not count: both skip archived rows', () => {
    const unique = entryOf('a.unique', 'owner', { owner: fieldOf({ unique: true }) });
    const partial = entryOf('a.partial', 'owner', { owner: fieldOf() }, [
      { name: 'p', fields: ['owner'], unique: false, where: { op: 'isNull', field: 'x' } as never },
    ]);
    expect(codes(checkDataSubjectIndexes(entities(unique, partial)))).toEqual([
      'dataSubjectUnindexed:warning:a.unique',
      'dataSubjectUnindexed:warning:a.partial',
    ]);
  });

  test('id needs no index, and a path is checked on every entity it walks through', () => {
    const own = entryOf('a.own', 'id', {});
    const leaf = entryOf('a.leaf', 'parentId.groupId.owner', {
      parentId: fieldOf({ indexed: true }, 'a.parent'),
    });
    const parent = entryOf('a.parent', null, { groupId: fieldOf({}, 'a.group') });
    const group = entryOf('a.group', null, { owner: fieldOf() });
    expect(codes(checkDataSubjectIndexes(entities(own, leaf, parent, group)))).toEqual([
      'dataSubjectUnindexed:warning:a.parent',
      'dataSubjectUnindexed:warning:a.group',
    ]);
    // Once every field of the path is indexed there is nothing to say.
    const indexed = entities(
      leaf,
      entryOf('a.parent', null, { groupId: fieldOf({ indexed: true }, 'a.group') }),
      entryOf('a.group', null, { owner: fieldOf({ indexed: true }) }),
    );
    expect(checkDataSubjectIndexes(indexed)).toEqual([]);
  });

  test('a field reached from two entities is reported once', () => {
    const one = entryOf('a.one', 'parentId.owner', { parentId: fieldOf({ indexed: true }, 'a.p') });
    const two = entryOf('a.two', 'parentId.owner', { parentId: fieldOf({ indexed: true }, 'a.p') });
    const target = entryOf('a.p', null, { owner: fieldOf() });
    expect(codes(checkDataSubjectIndexes(entities(one, two, target)))).toEqual([
      'dataSubjectUnindexed:warning:a.p',
    ]);
  });
});
