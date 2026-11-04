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
 * `migrate` for one namespace (section 3.3). Development: the tracks without migration files are
 * provisioned from the registry's snapshots and the pending files of the others are applied in run
 * order. Production: the applied history must match the committed files; drift refuses to start.
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
  const migrated = new Set(files.map((track) => track.track));
  const snapshots: readonly TrackSnapshot[] = snapshotsOf({
    registry: app.registry,
    planner,
    level: 'app',
  }).filter((snapshot) => !migrated.has(snapshot.track));
  await adapter.schema.provision(namespace, snapshots, { jobGroups: input.jobGroups });
  if (files.length > 0) {
    const order = planner.orderTracks(
      app.registry.modules.map((module) => ({
        id: module.id,
        requires: module.requires,
        optional: module.optional,
      })),
      files.map((track) => track.track),
    );
    const ordered = order.flatMap((track) =>
      files.filter((candidate) => candidate.track === track),
    );
    await planner.applyPending(adapter.schema, namespace, ordered);
  }
}
