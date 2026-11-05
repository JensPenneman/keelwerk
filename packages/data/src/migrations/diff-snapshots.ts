import type {
  ColumnSpec,
  FieldDescriptor,
  ForeignKeySpec,
  IndexSpec,
  MigrationStep,
  TableSpec,
  TrackSnapshot,
} from '@keelwerk/core';
import { canonicalizeJson, errors, physicalColumnName, physicalTableName } from '@keelwerk/core';

const same = (a: unknown, b: unknown): boolean => canonicalizeJson(a) === canonicalizeJson(b);

function byName<T extends { readonly name: string }>(items: readonly T[]): ReadonlyMap<string, T> {
  return new Map(items.map((item) => [item.name, item]));
}

function entityOfTable(snapshot: TrackSnapshot | null): ReadonlyMap<string, string> {
  const owners = new Map<string, string>();
  for (const ref of Object.keys(snapshot?.entities ?? {})) {
    const dot = ref.indexOf('.');
    owners.set(physicalTableName(ref.slice(0, dot), ref.slice(dot + 1)), ref);
  }
  return owners;
}

/**
 * The `dropColumn` step for a column that goes: the field when the column is the field's own,
 * otherwise the column's physical name in both `field` and `columns`, so a derived column (a tag
 * column, a CRDT value column) leaves alone and never takes a sibling field's column with it
 * (section 14.6.2: the step names the columns that go).
 */
function dropStep(entity: string, column: ColumnSpec): MigrationStep {
  const field = column.field;
  if (field !== null && physicalColumnName(field) === column.name) {
    return { op: 'dropColumn', entity, field };
  }
  return { op: 'dropColumn', entity, field: column.name, columns: [column.name] };
}

/** The renames the author confirms: each removed field is offered the added fields of its kind, once. */
async function askRenames(
  previous: TrackSnapshot | null,
  next: TrackSnapshot,
  ask: AskRename,
): Promise<readonly Rename[]> {
  const renames: Rename[] = [];
  for (const [entity, now] of Object.entries(next.entities)) {
    const before = previous?.entities[entity]?.fields ?? {};
    const removed = Object.entries(before).filter(([name]) => now.fields[name] === undefined);
    const added = Object.entries(now.fields).filter(([name]) => before[name] === undefined);
    const taken = new Set<string>();
    const plain = (field: FieldDescriptor): boolean => field.personal === false;
    for (const [from, oldField] of removed) {
      if (!plain(oldField)) continue;
      for (const [to, newField] of added) {
        if (taken.has(to) || !plain(newField) || newField.kind !== oldField.kind) continue;
        if (await ask({ entity, from, to })) {
          taken.add(to);
          renames.push({ entity, from, to });
          break;
        }
      }
    }
  }
  return renames;
}

function checkTags(previous: TrackSnapshot | null, next: TrackSnapshot): void {
  for (const [entity, now] of Object.entries(next.entities)) {
    for (const [name, field] of Object.entries(now.fields)) {
      const was = previous?.entities[entity]?.fields[name];
      if (was !== undefined && was.tag !== field.tag) {
        throw errors.validation(
          `${entity}.${name} changed its tag from ${was.tag} to ${field.tag}; pin the old tag with .tag(${was.tag})`,
        );
      }
    }
  }
}

/** A field that disappeared while another of the same kind appeared in the same entity. */
export interface RenameQuestion {
  readonly entity: string;
  readonly from: string;
  readonly to: string;
}

/** A rename the author confirmed. */
export type Rename = RenameQuestion;

/** The planner's answer to one question: true when `from` became `to`. */
export type AskRename = (question: RenameQuestion) => Promise<boolean>;

/** The neutral steps that turn one snapshot into the next, and the renames among them. */
export interface SnapshotDiff {
  readonly steps: readonly MigrationStep[];
  readonly renames: readonly Rename[];
}

/**
 * The neutral steps from `previous` (null before the track's first file) to `next` (section
 * 14.6.2). Order: drops of changed indexes and keys, new tables (without their foreign keys),
 * added columns, backfills of renames (gated like contract steps, so ahead of any tightening or drop of the same entity), altered columns, indexes, foreign keys, merge state, and last the
 * contract steps. A table with a primary key is created; one without belongs to another track
 * (a contribution or conditional part) and is added column by column. A required column added to
 * a table that exists is added nullable and tightened by a contract step, because rows exist.
 */
export async function diffSnapshots(
  previous: TrackSnapshot | null,
  next: TrackSnapshot,
  askRename: AskRename,
): Promise<SnapshotDiff> {
  checkTags(previous, next);
  const renames = await askRenames(previous, next, askRename);
  const before = byName(previous?.tables ?? []);
  const after = byName(next.tables);
  const entities = new Map([...entityOfTable(previous), ...entityOfTable(next)]);
  const entityOf = (table: string): string => entities.get(table) ?? table;
  const dropIndexes: MigrationStep[] = [];
  const created: MigrationStep[] = [];
  const added: MigrationStep[] = [];
  const altered: MigrationStep[] = [];
  const copied: MigrationStep[] = [];
  const indexed: MigrationStep[] = [];
  const keyed: MigrationStep[] = [];
  const merged: MigrationStep[] = [];
  const dropped: MigrationStep[] = [];
  for (const [name, table] of after) {
    const entity = entityOf(name);
    const old: TableSpec | undefined = before.get(name);
    const fresh = old === undefined && table.primaryKey.length > 0;
    if (fresh) {
      created.push({ op: 'createTable', entity, table: { ...table, foreignKeys: [] } });
      for (const key of table.foreignKeys) keyed.push({ op: 'addForeignKey', entity, key });
      continue;
    }
    const oldColumns = byName(old?.columns ?? []);
    for (const column of table.columns) {
      const was = oldColumns.get(column.name);
      const field = column.field ?? column.name;
      if (was === undefined) {
        const loose = old !== undefined && !column.nullable && column.default === null;
        added.push({
          op: 'addColumn',
          entity,
          field,
          column: loose ? { ...column, nullable: true } : column,
        });
        if (loose)
          altered.push({
            op: 'alterColumn',
            entity,
            field,
            from: { ...column, nullable: true },
            to: column,
          });
      } else if (!same(was, column)) {
        altered.push({ op: 'alterColumn', entity, field, from: was, to: column });
      }
    }
    const oldIndexes = byName(old?.indexes ?? []);
    for (const index of table.indexes) {
      const was: IndexSpec | undefined = oldIndexes.get(index.name);
      if (was !== undefined && same(was, index)) continue;
      if (was !== undefined) dropIndexes.push({ op: 'dropIndex', entity, index: was });
      indexed.push({ op: 'createIndex', entity, index });
    }
    const oldKeys = byName(old?.foreignKeys ?? []);
    for (const key of table.foreignKeys) {
      const was: ForeignKeySpec | undefined = oldKeys.get(key.name);
      if (was !== undefined && same(was, key)) continue;
      if (was !== undefined) dropIndexes.push({ op: 'dropForeignKey', entity, key: was });
      keyed.push({ op: 'addForeignKey', entity, key });
    }
  }
  for (const [name, table] of before) {
    const entity = entityOf(name);
    const kept = after.get(name);
    if (kept === undefined) {
      if (table.primaryKey.length > 0) {
        dropped.push({ op: 'dropTable', entity });
        continue;
      }
    }
    const keptColumns = byName(kept?.columns ?? []);
    for (const column of table.columns) {
      if (keptColumns.has(column.name)) continue;
      dropped.push(dropStep(entity, column));
    }
    const keptIndexes = byName(kept?.indexes ?? []);
    for (const index of table.indexes) {
      if (!keptIndexes.has(index.name)) dropIndexes.push({ op: 'dropIndex', entity, index });
    }
    const keptKeys = byName(kept?.foreignKeys ?? []);
    for (const key of table.foreignKeys) {
      if (!keptKeys.has(key.name)) dropIndexes.push({ op: 'dropForeignKey', entity, key });
    }
  }
  for (const rename of renames) {
    copied.push({ op: 'copyColumn', entity: rename.entity, from: rename.from, to: rename.to });
  }
  for (const [entity, now] of Object.entries(next.entities)) {
    if (now.mergeState && previous?.entities[entity]?.mergeState !== true) {
      merged.push({ op: 'enableMergeState', entity });
    }
  }
  const dropOrder = (step: MigrationStep): number => (step.op === 'dropColumn' ? 0 : 1);
  dropped.sort((a, b) => dropOrder(a) - dropOrder(b));
  return {
    steps: [
      ...dropIndexes,
      ...created,
      ...added,
      ...copied,
      ...altered,
      ...indexed,
      ...keyed,
      ...merged,
      ...dropped,
    ],
    renames,
  };
}
