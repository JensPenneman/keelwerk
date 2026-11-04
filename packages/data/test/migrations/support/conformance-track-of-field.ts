import type { EntityEntry } from '@keelwerk/core';

/** The registry does not record conditional fields (gap in 14.6.1): `loans[library]` adds `bookId`. */
export function conformanceTrackOfField(entry: EntityEntry, field: string): string {
  const own = entry.tracks[0]?.track ?? entry.module;
  if (entry.ref === 'loans.loan' && field === 'bookId') return 'loans[library]';
  const contributor = entry.origin[field];
  if (contributor === undefined) return own;
  return entry.tracks.find((track) => track.contributedBy === contributor)?.track ?? own;
}
