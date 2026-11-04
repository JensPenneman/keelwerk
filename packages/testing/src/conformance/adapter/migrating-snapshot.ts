import type { TrackSnapshot } from '@keelwerk/core';
import { migratingTable } from './migrating-table.ts';

/** The snapshot `provision` takes for the track. */
export const migratingSnapshot: TrackSnapshot = {
  track: 'conf',
  version: 1,
  tables: [migratingTable],
  entities: {},
};
