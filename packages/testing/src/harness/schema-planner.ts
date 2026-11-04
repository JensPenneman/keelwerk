import type { SchemaPlanner } from '@keelwerk/core';
import {
  applyPending,
  buildTrackSnapshot,
  checkMigrationHistory,
  loadMigrations,
  orderTracks,
} from '@keelwerk/data';

/**
 * The planner of `@keelwerk/data` as the infrastructure entry the runtime asks for: the core
 * imports nothing from the workspace, so a deployment lists this next to its adapters.
 */
export function schemaPlanner(): SchemaPlanner {
  return {
    kind: 'schemaPlanner',
    provides: [],
    snapshots: (entries, options) => buildTrackSnapshot(entries, options),
    orderTracks: (modules, tracks) => orderTracks(modules, tracks),
    loadTracks: (module, migrations) => loadMigrations(module, migrations),
    applyPending: (schema, namespace, tracks) => applyPending(schema, namespace, tracks),
    checkHistory: (history, tracks) => checkMigrationHistory(history, tracks),
  };
}
