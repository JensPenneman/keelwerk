import { snapshotsOf } from '../control/snapshots-of.ts';
import { errors } from '../errors/errors.ts';
import type { JobGroup } from '../jobs/job-group.ts';
import type { DataAdapter } from '../storage/data-adapter.ts';
import type { NamespaceRef } from '../storage/namespace-ref.ts';
import type { TrackSnapshot } from '../storage/track-snapshot.ts';
import type { SchemaPlanner, SchemaTrack } from './schema-planner.ts';
import type { ServedApp } from './served-app.ts';

/** The module a track belongs to: 'auth', 'auth->accounts' and 'auth[accounts]' all belong to 'auth'. */
function moduleOfTrack(track: string): string {
  return track.split(/->|\[/)[0] ?? track;
}

/** What `prepareNamespace` works from. */
export interface PrepareInput {
  readonly planner: SchemaPlanner | undefined;
  readonly adapter: DataAdapter;
  readonly namespace: NamespaceRef;
  readonly app: ServedApp;
  readonly tracks: readonly SchemaTrack[];
  readonly development: boolean;
  readonly jobGroups: readonly JobGroup[];
}

/**
 * `migrate` for one namespace (section 3.3). Development: one pass in run order over every
 * track, where a track with pending files applies them and a track without is provisioned from
 * the registry's snapshot. Production: the applied history must match the committed files; drift
 * refuses to start.
 * Without a planner only the in-memory adapter can be used, which needs no tables.
 */
export async function prepareNamespace(input: PrepareInput): Promise<void> {
  const { planner, adapter, namespace, app } = input;
  if (planner === undefined) return;
  const modules = new Set(app.source.modules.map((module) => module.id));
  const own = input.tracks.filter((track) => modules.has(moduleOfTrack(track.track)));
  const files = own.filter((track) => track.files.length > 0);
  if (!input.development) {
    const history = await adapter.schema.history(namespace);
    const drift = planner.checkHistory(history, own);
    if (drift.length > 0) {
      throw errors.conflict(`migration drift in ${namespace.root}: ${drift.join('; ')}`);
    }
    return;
  }
  // One pass in run order over every track: a track with files applies them, a track without is
  // provisioned from its snapshot. A contributing module's table joins a migrated track by a file
  // of its own, so the order decides which one creates the table.
  const withFiles = new Map(files.map((track) => [track.track, track]));
  const snapshots = new Map<string, TrackSnapshot>(
    snapshotsOf({ registry: app.registry, planner, level: 'app' }).map((snapshot) => [
      snapshot.track,
      snapshot,
    ]),
  );
  const order = planner.orderTracks(
    app.registry.modules.map((module) => ({
      id: module.id,
      requires: module.requires,
      optional: module.optional,
    })),
    [...new Set([...withFiles.keys(), ...snapshots.keys()])],
  );
  if (withFiles.size > 0) {
    // The framework tables (`kw_migrations` among them) exist before the first file runs.
    await adapter.schema.provision(namespace, [], { jobGroups: input.jobGroups });
  }
  let pending: TrackSnapshot[] = [];
  const flush = async (): Promise<void> => {
    await adapter.schema.provision(namespace, pending, { jobGroups: input.jobGroups });
    pending = [];
  };
  for (const name of order) {
    const track = withFiles.get(name);
    if (track !== undefined) {
      if (pending.length > 0) await flush();
      await planner.applyPending(adapter.schema, namespace, [track]);
      continue;
    }
    const snapshot = snapshots.get(name);
    if (snapshot !== undefined) pending.push(snapshot);
  }
  await flush();
}
