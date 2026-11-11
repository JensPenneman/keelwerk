import type { LiveView, StorageRow, Unit } from '@keelwerk/core';

function present(value: unknown): boolean {
  return value !== undefined && value !== null;
}

/** An archived row the subscriber still follows: its version, and its presented row when archived rows are followed. */
export interface ArchivedLost {
  readonly version: number;
  readonly row: StorageRow | undefined;
}

/**
 * Which of the ids the disclosure rule found "lost" are only archived: the row exists, is not erased,
 * is still selected by the subscriber's filter and plan, and carries an archive mark. Those are told
 * as `archived` (with the presented row when the subscriber follows archived rows) rather than as
 * `removed`; the rest stay `left-view` (D6).
 */
export async function archivedAmongLost(
  unit: Unit,
  view: LiveView,
  lost: Iterable<string>,
  loaded: ReadonlyMap<string, StorageRow>,
): Promise<Map<string, ArchivedLost>> {
  const candidates: StorageRow[] = [];
  for (const id of lost) {
    const row = loaded.get(id);
    if (row === undefined || present(row.kwErasedAt) || !present(row.archivedAt)) continue;
    if (view.inFilter(row)) candidates.push(row);
  }
  const found = new Map<string, ArchivedLost>();
  if (candidates.length === 0) return found;
  const selected = await view.inPlan(unit, candidates);
  const kept = candidates.filter((_row, index) => selected[index] === true);
  const shown = view.includeArchived ? await view.present(unit, kept) : [];
  for (const [index, row] of kept.entries()) {
    const one = shown[index];
    found.set(String(row.id), {
      version: Number(row.version),
      row: one === undefined ? undefined : view.project(one),
    });
  }
  return found;
}
