import type { ConditionInput } from '../conditions/condition-input.ts';
import { normalizeCondition } from '../conditions/normalize-condition.ts';
import { sha256 } from '../crypto/sha256.ts';
import { unicodeVersion } from '../encryption/unicode-version.ts';
import type { AnyField } from '../fields/field-def.ts';
import { canonicalizeJson } from '../json/canonicalize-json.ts';
import type { DerivedIndexField } from '../storage/derived-index-field.ts';
import type { EntityDescriptor } from '../storage/entity-descriptor.ts';
import type { FieldDescriptor } from '../storage/field-descriptor.ts';
import type { IndexDescriptor } from '../storage/index-descriptor.ts';
import type { PersonalQuery } from '../storage/personal-query.ts';
import { physicalColumnName } from '../storage/physical-column-name.ts';
import { physicalTableName } from '../storage/physical-table-name.ts';
import type { RelationDescriptor } from '../storage/relation-descriptor.ts';
import type { SearchIndexDescriptor } from '../storage/search-index-descriptor.ts';
import { buildFieldDescriptor } from './build-field-descriptor.ts';
import type { EntitySource } from './entity-sources.ts';
import { referenceTarget } from './reference-target.ts';
import type { RuntimeEntity } from './runtime-module.ts';

const derivedKinds: Readonly<Record<PersonalQuery, DerivedIndexField['kind'] | null>> = {
  eq: 'binary',
  prefix: 'tagSet',
  contains: 'tagSet',
  order: 'ore',
  search: null,
};

/** The track version before the module ships a migration file for it (section 14.6.1). */
const unmigratedVersion = 0;

/**
 * Tags are allocated per track, in declaration order, so a contributor or conditional part that is
 * switched off never shifts the tags of another track.
 */
function allocateTags(sources: readonly EntitySource[]): ReadonlyMap<AnyField, number> {
  const tags = new Map<AnyField, number>();
  for (const source of sources) {
    const defs = Object.values<AnyField>(source.fields);
    const taken = new Set<number>();
    for (const def of defs) if (def.flags.tag !== null) taken.add(def.flags.tag);
    let next = 1;
    for (const def of defs) {
      if (def.flags.tag !== null) continue;
      while (taken.has(next)) next += 1;
      tags.set(def, next);
      taken.add(next);
    }
  }
  return tags;
}

function derivedIndexesOf(
  fields: Readonly<Record<string, FieldDescriptor>>,
): Readonly<Record<string, DerivedIndexField>> {
  const derived: Record<string, DerivedIndexField> = {};
  for (const [field, descriptor] of Object.entries(fields)) {
    if (descriptor.personal === false) continue;
    for (const query of descriptor.personal.queries) {
      const kind = derivedKinds[query];
      if (kind === null) continue;
      const column = `${descriptor.column}__${query}`;
      derived[column] = { field, kind, query, column, keyVersion: 1, unicode: unicodeVersion() };
    }
  }
  return derived;
}

function indexesOf(input: EntityBuildInput): readonly IndexDescriptor[] {
  return input.entity.indexes.map((index) => {
    const columns = index.fields.map((name) => physicalColumnName(name));
    const unique = index.unique === true;
    return {
      name: physicalTableName(input.module, input.name, {
        suffix: `${columns.join('_')}_${unique ? 'uq' : 'ix'}`,
      }),
      fields: index.fields,
      unique,
      where: index.where === undefined ? null : normalizeCondition(index.where as ConditionInput),
    };
  });
}

function searchIndexesOf(
  input: EntityBuildInput,
  fields: Readonly<Record<string, FieldDescriptor>>,
): readonly SearchIndexDescriptor[] {
  return input.entity.searchIndexes.map((index) => {
    const tokens = index.fields.some((name) => fields[name]?.personal !== false);
    return {
      name: index.name,
      fields: index.fields,
      form: tokens ? 'tokens' : 'native',
      keys: tokens ? (index.keys ?? 'tenant') : null,
      languages: index.languages ?? [],
    };
  });
}

/** What the descriptor of one entity is built from. */
export interface EntityBuildInput {
  readonly module: string;
  readonly name: string;
  readonly entity: RuntimeEntity;
  /** Own definition first, then conditional parts and contributions (see `entitySources`). */
  readonly sources: readonly EntitySource[];
  /** Whether a database foreign key can enforce a reference to the entity (same scope). */
  readonly foreignKeyTo: (entityRef: string) => boolean;
}

/** A descriptor and where each of its fields and relations came from. */
export interface BuiltEntity {
  readonly descriptor: EntityDescriptor;
  /** Contributed field or relation name to the contributing module id. */
  readonly origin: Readonly<Record<string, string>>;
}

/**
 * The walkable descriptor of one entity (section 14.3.2): fields and relations of every active
 * source with physical names by the core's pure functions (S-59), the tracks and the shape id
 * (section 14.6.1), indexes, derived index fields of personal fields, and search indexes.
 */
export function buildEntityDescriptor(input: EntityBuildInput): BuiltEntity {
  const tags = allocateTags(input.sources);
  const fields: Record<string, FieldDescriptor> = {};
  const relations: Record<string, RelationDescriptor> = {};
  const origin: Record<string, string> = {};
  const tracks: Record<string, number> = {};
  for (const source of input.sources) {
    tracks[source.track] = unmigratedVersion;
    for (const [name, def] of Object.entries<AnyField>(source.fields)) {
      fields[name] = buildFieldDescriptor(name, def, {
        declaredBy: source.declaredBy,
        dataSubject: input.entity.dataSubject,
        tag: tags.get(def) ?? 0,
        foreignKeyTo: input.foreignKeyTo,
      });
      if (source.contributedBy !== null) origin[name] = source.contributedBy;
    }
    for (const [name, relation] of Object.entries(source.relations)) {
      const target = referenceTarget(relation.target, source.declaredBy);
      const join =
        relation.through === undefined
          ? null
          : referenceTarget({ own: true, entity: relation.through.entity }, source.declaredBy);
      relations[name] = {
        kind: relation.cardinality,
        target: target === null ? '' : `${target.module}.${target.entity}`,
        by: relation.keys.by,
        to: relation.keys.to,
        contributedBy: source.contributedBy,
        ...(relation.through === undefined || join === null
          ? {}
          : {
              through: {
                module: join.module,
                entity: join.entity,
                by: relation.keys.by,
                to: relation.keys.to,
                via: relation.through.via,
              },
            }),
      };
      if (source.contributedBy !== null) origin[name] = source.contributedBy;
    }
  }
  const ref = `${input.module}.${input.name}`;
  const descriptor: EntityDescriptor = {
    ref,
    module: input.module,
    name: input.name,
    history: input.entity.history,
    tenancy: input.entity.tenancy,
    shape: { id: sha256(canonicalizeJson({ entity: ref, tracks })), tracks },
    dataSubject: input.entity.dataSubject,
    table: physicalTableName(input.module, input.name),
    fields,
    relations,
    indexes: indexesOf(input),
    partition: input.entity.partition,
    mergeState: Object.values(input.entity.actions).some(
      (action) => (action.spec as { readonly offline?: boolean }).offline === true,
    ),
    searchIndexes: searchIndexesOf(input, fields),
    derivedIndexes: derivedIndexesOf(fields),
    external: null,
  };
  return { descriptor, origin };
}
