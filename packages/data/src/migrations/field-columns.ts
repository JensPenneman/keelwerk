import type {
  ColumnSpec,
  DerivedIndexField,
  FieldConstraints,
  FieldDescriptor,
} from '@keelwerk/core';

/** The constraints a column carries (section 14.6.2); validation bounds stay out of the schema. */
function columnConstraints(constraints: FieldConstraints): FieldConstraints {
  const kept: {
    -readonly [K in keyof FieldConstraints]: FieldConstraints[K];
  } = {};
  if (constraints.maxLength !== undefined) kept.maxLength = constraints.maxLength;
  if (constraints.precision !== undefined) kept.precision = constraints.precision;
  if (constraints.scale !== undefined) kept.scale = constraints.scale;
  if (constraints.values !== undefined) kept.values = constraints.values;
  if (constraints.wide !== undefined) kept.wide = constraints.wide;
  if (constraints.per !== undefined) kept.per = constraints.per;
  return kept;
}

/**
 * The columns one field stores (section 14.5.1). A personal field is a sealed `bytea` plus one
 * column per index capability, nullable because erasure clears them; a CRDT field is the document
 * plus its materialisation. `nullable` forces the columns of a contribution or conditional part
 * to accept rows inserted while the part was inactive (section 14.6.5).
 */
export function fieldColumns(
  name: string,
  descriptor: FieldDescriptor,
  derived: readonly Pick<DerivedIndexField, 'column' | 'query' | 'kind' | 'unicode'>[],
  forceNullable: boolean,
): readonly ColumnSpec[] {
  if (descriptor.personal !== false) {
    return [
      {
        name: descriptor.column,
        field: name,
        kind: 'sealed',
        nullable: true,
        default: null,
        constraints: {},
      },
      ...derived.map(
        (index): ColumnSpec => ({
          name: index.column,
          field: name,
          kind: 'tags',
          nullable: true,
          default: null,
          constraints: {},
          derived: { query: index.query, kind: index.kind, unicode: index.unicode },
        }),
      ),
    ];
  }
  const nullable = forceNullable || descriptor.optional;
  const crdt =
    descriptor.kind === 'richText' ||
    (descriptor.kind === 'list' && descriptor.merge === 'sequence');
  const base: ColumnSpec = {
    name: descriptor.column,
    field: name,
    kind: crdt ? 'binary' : descriptor.kind,
    nullable,
    default: null,
    constraints: columnConstraints(descriptor.constraints),
  };
  if (!crdt) return [base];
  return [
    base,
    {
      name: `${descriptor.column}_value`,
      field: name,
      kind: descriptor.kind === 'richText' ? 'text' : 'json',
      nullable: true,
      default: null,
      constraints: {},
    },
  ];
}
