import type { SchemaPlanner } from '@keelwerk/core';
import { applyPending } from './apply-pending.ts';
import { buildTrackSnapshot } from './build-track-snapshot.ts';
import { checkMigrationHistory } from './check-migration-history.ts';
import { isTrackActive } from './is-track-active.ts';
import { loadMigrations } from './load-migrations.ts';
import { orderTracks } from './order-tracks.ts';

/**
 * The planner of this package as the infrastructure entry the runtime asks for: the core imports
 * nothing from the workspace, so a deployment lists this next to its adapters.
 */
export function schemaPlanner(): SchemaPlanner {
  return {
    kind: 'schemaPlanner',
    provides: [],
    snapshots: (entries, options) => buildTrackSnapshot(entries, options),
    orderTracks: (modules, tracks) => orderTracks(modules, tracks),
    isTrackActive: (track, selected) => isTrackActive(track, selected),
    loadTracks: (module, migrations) => loadMigrations(module, migrations),
    applyPending: (schema, namespace, tracks) => applyPending(schema, namespace, tracks),
    checkHistory: (history, tracks) => checkMigrationHistory(history, tracks),
  };
}
