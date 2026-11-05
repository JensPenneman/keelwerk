import type { NamespaceRef, Registry, TrackSnapshot } from '@keelwerk/core';
import {
  applyPending,
  columnType,
  compareCatalogue,
  orderTracks,
  samePredicate,
} from '@keelwerk/data';
import { pgliteAdapter } from '@keelwerk/data/pglite';
import type { MigrationTarget } from '../producers/migration-target.ts';
import type { ScratchCheckResult } from './scratch-check-result.ts';

const scratch: NamespaceRef = {
  id: 'scratch',
  placementId: 'scratch',
  appId: 'scratch',
  tenantId: null,
  root: 'kw_scratch',
};

/**
 * `db check` for one app (section 14.8.5): migrates a scratch PGlite database through the
 * committed files of the app's tracks, in run order, and compares its catalogue with the
 * committed snapshots. The scratch database lives in memory and is closed again.
 */
export async function scratchCheck(
  app: string,
  registry: Registry,
  targets: readonly MigrationTarget[],
): Promise<ScratchCheckResult> {
  const tracks = orderTracks(
    registry.modules.map((module) => ({
      id: module.id,
      requires: module.requires,
      optional: module.optional,
    })),
    targets.map((target) => target.track),
  );
  const byTrack = new Map(targets.map((target) => [target.track, target]));
  const ordered = tracks.flatMap((track) => {
    const target = byTrack.get(track);
    return target === undefined ? [] : [target];
  });
  const missing = ordered.filter((target) => target.committed.snapshot === null);
  if (missing.length > 0) {
    return {
      app,
      tracks,
      failure: `${missing.map((target) => target.track).join(', ')} has no snapshot; run keelwerk db generate`,
      differences: [],
    };
  }
  const adapter = pgliteAdapter({ deploymentId: '00000000-0000-7000-8000-00000000c0de' });
  try {
    await adapter.connect();
    await adapter.asOwner(async (database) => {
      await database.query(
        'create role "kw_app" nosuperuser nobypassrls nocreatedb nocreaterole nologin',
      );
    });
    await adapter.schema.provision(scratch, []);
    await applyPending(
      adapter.schema,
      scratch,
      ordered.map((target) => ({ track: target.track, files: target.committed.files })),
      { contract: { buildId: 'scratch', liveBuildIds: async () => [] } },
    );
    const live = await adapter.schema.introspect({ namespace: scratch });
    const snapshots = ordered.flatMap((target) =>
      target.committed.snapshot === null ? [] : [target.committed.snapshot satisfies TrackSnapshot],
    );
    return {
      app,
      tracks,
      differences: compareCatalogue(snapshots, live, { typeOf: columnType, samePredicate }),
    };
  } catch (error) {
    return {
      app,
      tracks,
      failure: error instanceof Error ? error.message : String(error),
      differences: [],
    };
  } finally {
    await adapter.close(1000).catch(() => undefined);
  }
}
