import type { TrackSnapshot } from '../storage/track-snapshot.ts';

/** The member tags the snapshots record for a field of an entity; the first snapshot that records any wins. */
export function recordedMemberTags(
  snapshots: readonly TrackSnapshot[] | undefined,
):
  | ((entityRef: string, field: string) => Readonly<Record<string, number>> | undefined)
  | undefined {
  if (snapshots === undefined || snapshots.length === 0) return undefined;
  return (entityRef, field) => {
    for (const snapshot of snapshots) {
      const tags = snapshot.entities[entityRef]?.fields[field]?.memberTags;
      if (tags !== undefined) return tags;
    }
    return undefined;
  };
}
