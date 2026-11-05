import type { EntityDescriptor, EntityEntry, TrackSnapshot } from '@keelwerk/core';
import { buildTrackSnapshot } from '../migrations/build-track-snapshot.ts';

/** The snapshot of the `conf` track the conformance descriptors describe, as the registry would build it. */
export function conformanceSnapshot(entities: readonly EntityDescriptor[]): TrackSnapshot {
  const entries: EntityEntry[] = entities.map((descriptor) => ({
    ref: descriptor.ref,
    module: descriptor.module,
    name: descriptor.name,
    prefix: descriptor.name,
    descriptor,
    tracks: [{ entity: descriptor.ref, track: 'conf', version: 1, contributedBy: null }],
    generated: [],
    origin: {},
    page: { sortable: [], defaultSort: [], defaultSize: 20, maxSize: 100 },
    events: {},
  }));
  const snapshot = buildTrackSnapshot(entries, { trackOfField: () => 'conf' }).get('conf');
  if (snapshot === undefined) throw new Error('the conformance descriptors produced no snapshot');
  return snapshot;
}
