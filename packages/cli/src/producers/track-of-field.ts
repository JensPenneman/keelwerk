import type { EntityEntry } from '@keelwerk/core';

/** The track a field belongs to: what the registry recorded, else the owner's own track. */
export function trackOfField(entry: EntityEntry, field: string): string {
  return entry.fieldTracks?.[field] ?? entry.tracks[0]?.track ?? entry.module;
}
