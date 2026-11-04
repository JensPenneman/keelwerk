import type { TrackSnapshot } from '@keelwerk/core';
import { buildTrackSnapshot } from '../../../src/index.ts';
import { conformanceEntries } from './conformance-entries.ts';
import { conformanceTrackOfField } from './conformance-track-of-field.ts';

/** The snapshots of every track of the conformance app. */
export const conformanceSnapshots: ReadonlyMap<string, TrackSnapshot> = buildTrackSnapshot(
  conformanceEntries,
  { trackOfField: conformanceTrackOfField },
);
