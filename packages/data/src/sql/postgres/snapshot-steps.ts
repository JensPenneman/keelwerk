import type { MigrationStep, TableSpec, TrackSnapshot } from '@keelwerk/core';
import { diffSnapshots } from '../../migrations/diff-snapshots.ts';

/**
 * What of the snapshot the live tables already hold: the snapshot's own specification of every
 * column, index and foreign key whose name exists live. Comparing a snapshot with itself, not
 * with the live catalogue's reading of it, keeps what introspection cannot see (a partial index's
 * condition) from looking like a change.
 */
function heldPart(snapshot: TrackSnapshot, live: readonly TableSpec[]): TrackSnapshot {
  const tables: TableSpec[] = [];
  for (const table of snapshot.tables) {
    const held = live.find((candidate) => candidate.name === table.name);
    if (held === undefined) continue;
    const names = (items: readonly { readonly name: string }[]): Set<string> =>
      new Set(items.map((item) => item.name));
    const columns = names(held.columns);
    const indexes = names(held.indexes);
    const keys = names(held.foreignKeys);
    tables.push({
      ...table,
      columns: table.columns.filter((column) => columns.has(column.name)),
      indexes: table.indexes.filter((index) => indexes.has(index.name)),
      foreignKeys: table.foreignKeys.filter((key) => keys.has(key.name)),
    });
  }
  return { ...snapshot, tables };
}

/**
 * The expand steps that bring a database up to a snapshot, skipping what is already there:
 * missing tables, columns, indexes and foreign keys (`provision`, section 14.6.6). Nothing is
 * dropped or altered, so running it again changes nothing.
 */
export async function snapshotSteps(
  snapshot: TrackSnapshot,
  live: readonly TableSpec[],
): Promise<readonly MigrationStep[]> {
  const held = heldPart(snapshot, live);
  const diff = await diffSnapshots(held, snapshot, async () => false);
  const additions = new Set(['createTable', 'addColumn', 'createIndex', 'addForeignKey']);
  return diff.steps.filter((step) => additions.has(step.op));
}
