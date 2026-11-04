import type { EntityEntry, TrackSnapshot } from '@keelwerk/core';
import { buildTrackSnapshot } from '../../../src/index.ts';

/** The `library` track of a version of `library.book` (its own fields only: the contribution is not in this entry's fields). */
export function libraryTrack(
  book: EntityEntry,
  versions: Record<string, number> = {},
): TrackSnapshot {
  const snapshot = buildTrackSnapshot([book], {
    versions,
    trackOfField: (entry) => entry.tracks[0]?.track ?? 'library',
  }).get('library');
  if (snapshot === undefined) throw new Error('no library track');
  return snapshot;
}
