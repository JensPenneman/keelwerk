import type { TrackSnapshot } from '@keelwerk/core';
import type { TrackFiles } from '../../../src/index.ts';
import { orderTracks, planTrack } from '../../../src/index.ts';
import { conformanceModules } from './conformance-modules.ts';
import { noRename } from './no-rename.ts';

/** Every track planned from nothing, in run order: one file each (initial files have no contract steps). */
export async function planAllTracks(
  snapshots: ReadonlyMap<string, TrackSnapshot>,
): Promise<readonly TrackFiles[]> {
  const tracks: TrackFiles[] = [];
  for (const track of orderTracks(conformanceModules, [...snapshots.keys()])) {
    const desired = snapshots.get(track);
    if (desired === undefined) continue;
    const plan = await planTrack({ previous: null, desired, name: 'initial', ask: noRename });
    tracks.push({ track, files: plan?.files ?? [] });
  }
  return tracks;
}
