import type { TrackSnapshot } from '@keelwerk/core';
import type { Rename } from './diff-snapshots.ts';

/** The snapshot with the renames a file made appended to its entities' rename history (section 14.6.1). */
export function recordRenames(
  snapshot: TrackSnapshot,
  renames: readonly Rename[],
  file: string,
): TrackSnapshot {
  if (renames.length === 0) return snapshot;
  const entities = { ...snapshot.entities };
  for (const rename of renames) {
    const entity = entities[rename.entity];
    if (entity === undefined) continue;
    entities[rename.entity] = {
      ...entity,
      renames: [...entity.renames, { from: rename.from, to: rename.to, file }],
    };
  }
  return { ...snapshot, entities };
}
