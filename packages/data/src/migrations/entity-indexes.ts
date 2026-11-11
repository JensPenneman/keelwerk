import type { Condition, EntityDescriptor, IndexSpec } from '@keelwerk/core';
import { errors, physicalColumnName, physicalTableName } from '@keelwerk/core';

const notArchived: Condition = { op: 'isNull', field: 'archivedAt', value: true };

/**
 * The column a declared index uses for a field. A personal field is sealed with a fresh nonce per
 * row, so its ciphertext column never repeats: the index goes on the blind-index equality column,
 * and a personal field without one cannot be indexed.
 */
function indexColumn(descriptor: EntityDescriptor, indexName: string, name: string): string {
  const field = descriptor.fields[name];
  if (field === undefined || field.personal === false) return physicalColumnName(name);
  const eq = Object.values(descriptor.derivedIndexes).find(
    (derived) => derived.field === name && derived.query === 'eq',
  );
  if (eq === undefined) {
    throw errors.unsupported(
      `${descriptor.ref}: index ${indexName} names the personal field ${name}, which has no eq index; declare queries: ['eq'] on it or leave it out of the index`,
    );
  }
  return eq.column;
}

/** An index and the fields whose columns it needs (its track is the latest of theirs). */
export interface OwnedIndex {
  readonly spec: IndexSpec;
  readonly fields: readonly string[];
}

/**
 * Every index of an entity table (sections 14.5.1 and 14.7.9.6): uniqueness among non-archived
 * rows, plain indexes of `indexed` fields, the declared indexes, the GIN indexes of prefix and
 * trigram tags and of token search indexes. Row indexes lead with the scope column. A table
 * without `archived_at` (an invocation table) passes `archivable: false`: its unique indexes
 * hold no predicate, since no row is ever archived.
 */
export function entityIndexes(
  descriptor: EntityDescriptor,
  scopeColumn: string | null,
  options: { readonly archivable?: boolean } = {},
): readonly OwnedIndex[] {
  const unique = options.archivable === false ? null : notArchived;
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
            where: field.unique ? unique : null,
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
          where: field.unique ? unique : null,
        },
        fields: [name],
      });
    }
  }
  for (const index of descriptor.indexes) {
    add({
      spec: {
        name: index.name,
        columns: [
          ...lead,
          ...index.fields.map((field) => indexColumn(descriptor, index.name, field)),
        ],
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
