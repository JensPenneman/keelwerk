import type { Condition, EntityDescriptor, IndexSpec } from '@keelwerk/core';
import { physicalColumnName, physicalTableName } from '@keelwerk/core';

const notArchived: Condition = { op: 'isNull', field: 'archivedAt', value: true };

/** An index and the fields whose columns it needs (its track is the latest of theirs). */
export interface OwnedIndex {
  readonly spec: IndexSpec;
  readonly fields: readonly string[];
}

/**
 * Every index of an entity table (sections 14.5.1 and 14.7.9.6): uniqueness among non-archived
 * rows, plain indexes of `indexed` fields, the declared indexes, the GIN indexes of prefix and
 * trigram tags and of token search indexes. Row indexes lead with the scope column.
 */
export function entityIndexes(
  descriptor: EntityDescriptor,
  scopeColumn: string | null,
): readonly OwnedIndex[] {
  const lead = scopeColumn === null ? [] : [scopeColumn];
  const named = (suffix: string): string =>
    physicalTableName(descriptor.module, descriptor.name, { suffix });
  const found: OwnedIndex[] = [];
  const add = (index: OwnedIndex): void => {
    if (!found.some((other) => other.spec.name === index.spec.name)) found.push(index);
  };
  for (const [name, field] of Object.entries(descriptor.fields)) {
    if (field.personal !== false) {
      const eq = Object.values(descriptor.derivedIndexes).find(
        (derived) => derived.field === name && derived.query === 'eq',
      );
      if (eq !== undefined) {
        add({
          spec: {
            name: named(`${eq.column}_${field.unique ? 'uq' : 'ix'}`),
            columns: [...lead, eq.column],
            unique: field.unique,
            method: 'btree',
            where: field.unique ? notArchived : null,
          },
          fields: [name],
        });
      }
      continue;
    }
    if (field.unique || field.indexed) {
      add({
        spec: {
          name: named(`${field.column}_${field.unique ? 'uq' : 'ix'}`),
          columns: [...lead, field.column],
          unique: field.unique,
          method: 'btree',
          where: field.unique ? notArchived : null,
        },
        fields: [name],
      });
    }
  }
  for (const index of descriptor.indexes) {
    add({
      spec: {
        name: index.name,
        columns: [...lead, ...index.fields.map((field) => physicalColumnName(field))],
        unique: index.unique,
        method: 'btree',
        where: index.where,
      },
      fields: index.fields,
    });
  }
  for (const derived of Object.values(descriptor.derivedIndexes)) {
    if (derived.kind !== 'tagSet') continue;
    add({
      spec: {
        name: named(`${derived.column}_ix`),
        columns: [derived.column],
        unique: false,
        method: 'gin',
        where: null,
      },
      fields: [derived.field],
    });
  }
  for (const search of descriptor.searchIndexes) {
    if (search.form !== 'tokens') continue;
    add({
      spec: {
        name: named(`kw_search_${search.name}_ix`),
        columns: [`kw_search_${search.name}`],
        unique: false,
        method: 'gin',
        where: null,
      },
      fields: search.fields,
    });
  }
  return found;
}
