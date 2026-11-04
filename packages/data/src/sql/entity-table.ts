import type {
  DerivedIndexField,
  EntityDescriptor,
  FieldDescriptor,
  FieldKind,
} from '@keelwerk/core';
import { physicalColumnName } from '@keelwerk/core';

/**
 * The one place that maps names and columns for the SQL family (S-59). Physical table and column
 * names equal the derived names (decision 55b), so the descriptor already carries them; the
 * system and framework columns, which a descriptor may leave out, are named here with
 * `physicalColumnName`.
 */

function descriptor(kind: FieldKind, name: string, optional: boolean): FieldDescriptor {
  return {
    kind,
    column: physicalColumnName(name),
    optional,
    unique: false,
    indexed: false,
    hidden: false,
    maskable: false,
    stateOnly: false,
    sealed: false,
    merge: 'lww',
    personal: false,
    constraints: {},
    ref: null,
    inner: null,
    codec: null,
    tag: 0,
  };
}

const systemFields: Readonly<Record<string, FieldDescriptor>> = {
  id: descriptor('ref', 'id', false),
  createdAt: descriptor('instant', 'createdAt', false),
  updatedAt: descriptor('instant', 'updatedAt', false),
  archivedAt: descriptor('instant', 'archivedAt', true),
  version: descriptor('integer', 'version', false),
  // The framework columns of 14.4.2.
  kwLastHlc: descriptor('string', 'kwLastHlc', true),
  kwLastHash: descriptor('string', 'kwLastHash', true),
  kwErasedAt: descriptor('instant', 'kwErasedAt', true),
  tenantId: descriptor('ref', 'tenantId', false),
  backendId: descriptor('ref', 'backendId', false),
};

function scopeColumnOf(entity: EntityDescriptor): 'tenant_id' | 'backend_id' | null {
  if (entity.tenancy === 'tenant') return 'tenant_id';
  if (entity.tenancy === 'backend') return 'backend_id';
  return null;
}

/** A column an entity's condition, sort or select can name. */
export interface ColumnRef {
  /** The field name (or derived index name) the caller used. */
  readonly path: string;
  /** The physical column. */
  readonly column: string;
  readonly field: FieldDescriptor;
  /** Set when the path names a derived index column of a personal field. */
  readonly derived: DerivedIndexField | undefined;
  /** An id, version, timestamp or framework column rather than a declared field. */
  readonly system: boolean;
}

/** An entity's table in a statement: schema, physical name, alias and the column lookup. */
export interface EntityTable {
  readonly entity: EntityDescriptor;
  /** The namespace root (PostgreSQL schema), `null` for a name prefix or a bare file. */
  readonly schema: string | null;
  readonly name: string;
  readonly alias: string;
  /** The scope column of the entity's tenancy, `null` for deployment-level and invocation tables. */
  readonly scopeColumn: 'tenant_id' | 'backend_id' | null;
  /** `schema.table as alias`, for `selectFrom`. */
  readonly from: string;
  /** The `alias.column` reference of a column. */
  reference(column: string): string;
  /** Resolves a field, system field or derived index name; `undefined` when the entity has none. */
  column(path: string): ColumnRef | undefined;
}

/**
 * The table of an entity inside a namespace root, under an alias. `root` is `NamespaceRef.root`.
 */
export function entityTable(
  entity: EntityDescriptor,
  root: string | null,
  alias: string,
): EntityTable {
  const prefix = root === null ? '' : `${root}.`;
  return {
    entity,
    schema: root,
    name: entity.table,
    alias,
    scopeColumn: scopeColumnOf(entity),
    from: `${prefix}${entity.table} as ${alias}`,
    reference: (column) => `${alias}.${column}`,
    column: (path) => {
      const declared = Object.hasOwn(entity.fields, path) ? entity.fields[path] : undefined;
      if (declared !== undefined) {
        return {
          path,
          column: declared.column,
          field: declared,
          derived: undefined,
          system: false,
        };
      }
      const derived = Object.hasOwn(entity.derivedIndexes, path)
        ? entity.derivedIndexes[path]
        : undefined;
      if (derived !== undefined) {
        // A tag column holds a blind index tag (`binary`) or an array; its own codec decides.
        return {
          path,
          column: derived.column,
          field: { ...descriptor('binary', derived.column, true), column: derived.column },
          derived,
          system: false,
        };
      }
      const system = Object.hasOwn(systemFields, path) ? systemFields[path] : undefined;
      if (system !== undefined) {
        return { path, column: system.column, field: system, derived: undefined, system: true };
      }
      return undefined;
    },
  };
}
