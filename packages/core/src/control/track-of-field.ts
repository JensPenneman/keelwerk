import type { EntityEntry } from '../registry/entity-entry.ts';

/** The track a field belongs to: what the registry recorded (`EntityEntry.fieldTracks`, F-10), else the owner's track. */
export function trackOfField(entry: EntityEntry, field: string): string {
  return entry.fieldTracks?.[field] ?? entry.tracks[0]?.track ?? entry.module;
}
