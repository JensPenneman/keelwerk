import type { Registry } from '../registry/registry.ts';
import type { SchemaPlanner } from '../runtime/schema-planner.ts';
import type { TrackSnapshot } from '../storage/track-snapshot.ts';
import { trackOfField } from './track-of-field.ts';

/**
 * The snapshots a namespace is provisioned from, in run order (section 14.6.3). 'control': the
 * deployment-tenancy entities of the core; 'app': everything of tenant or backend tenancy.
 */
export function snapshotsOf(input: {
  readonly registry: Registry;
  readonly planner: SchemaPlanner;
  readonly level: 'control' | 'app';
}): readonly TrackSnapshot[] {
  const { registry, planner } = input;
  const entries = [...registry.entities.values()].filter((entry) =>
    input.level === 'control'
      ? entry.descriptor.tenancy === 'deployment'
      : entry.descriptor.tenancy !== 'deployment',
  );
  const snapshots = planner.snapshots(entries, { trackOfField });
  const ordered = planner.orderTracks(
    registry.modules.map((module) => ({
      id: module.id,
      requires: module.requires,
      optional: module.optional,
    })),
    [...snapshots.keys()],
  );
  return ordered.flatMap((track) => {
    const snapshot = snapshots.get(track);
    return snapshot === undefined ? [] : [snapshot];
  });
}
