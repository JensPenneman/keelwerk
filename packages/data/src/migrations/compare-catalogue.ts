import type {
  ColumnSpec,
  ForeignKeySpec,
  IndexSpec,
  TableSpec,
  TrackSnapshot,
} from '@keelwerk/core';
import { canonicalizeJson } from '@keelwerk/core';
import type { CatalogueDialect } from './catalogue-dialect.ts';
import type { LiveCatalogue } from './live-catalogue.ts';

interface Expected {
  readonly columns: Map<string, ColumnSpec>;
  readonly indexes: Map<string, IndexSpec>;
  readonly foreignKeys: Map<string, ForeignKeySpec>;
  primaryKey: readonly string[];
  scoped: TableSpec['scoped'];
}

/** Every track's part of each table, merged into the table the database should hold. */
function expectedTables(snapshots: readonly TrackSnapshot[]): ReadonlyMap<string, Expected> {
  const merged = new Map<string, Expected>();
  for (const snapshot of snapshots) {
    for (const table of snapshot.tables) {
      let target = merged.get(table.name);
      if (target === undefined) {
        target = {
          columns: new Map(),
          indexes: new Map(),
          foreignKeys: new Map(),
          primaryKey: [],
          scoped: table.scoped,
        };
        merged.set(table.name, target);
      }
      for (const column of table.columns) target.columns.set(column.name, column);
      for (const index of table.indexes) target.indexes.set(index.name, index);
      for (const key of table.foreignKeys) target.foreignKeys.set(key.name, key);
      if (table.primaryKey.length > 0) {
        target.primaryKey = table.primaryKey;
        target.scoped = table.scoped;
      }
    }
  }
  return merged;
}

/** The policies every entity table carries (section 14.4.5). */
const requiredPolicies = ['maintenance', 'scoped'] as const;

const sameList = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((item, index) => item === b[index]);

/** One way a live catalogue differs from the snapshots (section 14.8.5). */
export interface CatalogueDifference {
  readonly table: string;
  readonly kind:
    | 'missingTable'
    | 'extraTable'
    | 'missingColumn'
    | 'extraColumn'
    | 'columnType'
    | 'columnNullability'
    | 'columnDefault'
    | 'primaryKey'
    | 'missingIndex'
    | 'extraIndex'
    | 'indexDefinition'
    | 'missingForeignKey'
    | 'extraForeignKey'
    | 'foreignKeyDefinition'
    | 'missingPolicy'
    | 'rowSecurity';
  readonly detail: string;
}

/** How `compareCatalogue` is tuned. */
export interface CompareOptions {
  /** Tables that are none of the snapshots' business; default: the framework's `kw_` tables. */
  readonly ignoreTable?: (name: string) => boolean;
}

/**
 * Compares a live catalogue with the track snapshots (`keelwerk db check`, section 14.8.5):
 * missing or extra tables, columns, indexes and foreign keys, column types, nullability and
 * defaults, primary keys, and the row-level security policy every table must carry. Differences
 * come in a stable order; none means the database matches.
 */
export function compareCatalogue(
  snapshots: readonly TrackSnapshot[],
  live: LiveCatalogue,
  dialect: CatalogueDialect,
  options: CompareOptions = {},
): readonly CatalogueDifference[] {
  const ignore = options.ignoreTable ?? ((name: string) => name.startsWith('kw_'));
  const expected = expectedTables(snapshots);
  const actual = new Map(live.tables.filter((t) => !ignore(t.name)).map((t) => [t.name, t]));
  const found: CatalogueDifference[] = [];
  const report = (table: string, kind: CatalogueDifference['kind'], detail: string): void => {
    found.push({ table, kind, detail });
  };
  for (const name of [...expected.keys()].sort()) {
    const want = expected.get(name);
    const have = actual.get(name);
    if (want === undefined) continue;
    if (have === undefined) {
      report(name, 'missingTable', `${name} is not in the database`);
      continue;
    }
    const columns = new Map(have.columns.map((column) => [column.name, column]));
    for (const [column, spec] of want.columns) {
      const present = columns.get(column);
      if (present === undefined) {
        report(name, 'missingColumn', `${name}.${column} is not in the database`);
        continue;
      }
      const type = live.types?.[`${name}.${column}`] ?? dialect.typeOf(present);
      if (type !== dialect.typeOf(spec)) {
        report(
          name,
          'columnType',
          `${name}.${column} is ${type}, expected ${dialect.typeOf(spec)}`,
        );
      }
      if (present.nullable !== spec.nullable) {
        report(
          name,
          'columnNullability',
          `${name}.${column} nullable is ${present.nullable}, expected ${spec.nullable}`,
        );
      }
      if (present.default !== spec.default) {
        report(
          name,
          'columnDefault',
          `${name}.${column} default is ${String(present.default)}, expected ${String(spec.default)}`,
        );
      }
    }
    for (const column of columns.keys()) {
      if (!want.columns.has(column))
        report(name, 'extraColumn', `${name}.${column} is not in any snapshot`);
    }
    if (want.primaryKey.length > 0 && !sameList(have.primaryKey, want.primaryKey)) {
      report(
        name,
        'primaryKey',
        `${name} has key (${have.primaryKey.join(', ')}), expected (${want.primaryKey.join(', ')})`,
      );
    }
    const indexes = new Map(have.indexes.map((index) => [index.name, index]));
    for (const [index, spec] of want.indexes) {
      const present = indexes.get(index);
      if (present === undefined) {
        report(name, 'missingIndex', `${index} is not in the database`);
        continue;
      }
      const predicate = live.predicates?.[index];
      const partial =
        spec.where === null
          ? predicate === undefined
          : predicate !== undefined && dialect.samePredicate(spec.where, predicate);
      if (
        !sameList(present.columns, spec.columns) ||
        present.unique !== spec.unique ||
        present.method !== spec.method ||
        !partial
      ) {
        report(name, 'indexDefinition', `${index} differs from its snapshot`);
      }
    }
    for (const index of indexes.keys()) {
      if (!want.indexes.has(index)) report(name, 'extraIndex', `${index} is not in any snapshot`);
    }
    const keys = new Map(have.foreignKeys.map((key) => [key.name, key]));
    for (const [key, spec] of want.foreignKeys) {
      const present = keys.get(key);
      if (present === undefined) {
        report(name, 'missingForeignKey', `${key} is not in the database`);
      } else if (canonicalizeJson(present) !== canonicalizeJson(spec)) {
        report(name, 'foreignKeyDefinition', `${key} differs from its snapshot`);
      }
    }
    for (const key of keys.keys()) {
      if (!want.foreignKeys.has(key))
        report(name, 'extraForeignKey', `${key} is not in any snapshot`);
    }
    if (live.policies !== undefined) {
      for (const policy of requiredPolicies) {
        if (!(live.policies[name] ?? []).includes(policy)) {
          report(name, 'missingPolicy', `${name} has no row-level security policy ${policy}`);
        }
      }
    }
    const security = live.security?.[name];
    if (security !== undefined && !(security.enabled && security.forced)) {
      report(name, 'rowSecurity', `${name} does not enable and force row-level security`);
    }
  }
  for (const name of [...actual.keys()].sort()) {
    if (!expected.has(name)) report(name, 'extraTable', `${name} is in no snapshot`);
  }
  return found;
}
