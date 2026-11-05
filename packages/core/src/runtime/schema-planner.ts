import type { EntityEntry } from '../registry/entity-entry.ts';
import type { AppliedMigration } from '../storage/applied-migration.ts';
import type { MigrationFile } from '../storage/migration-file.ts';
import type { NamespaceRef } from '../storage/namespace-ref.ts';
import type { SchemaOperations } from '../storage/schema-operations.ts';
import type { TrackSnapshot } from '../storage/track-snapshot.ts';

/** The files of one migration track as the planner loaded them. */
export interface SchemaTrack {
  readonly track: string;
  readonly files: readonly MigrationFile[];
  /** Null until the track has a file. */
  readonly snapshot: TrackSnapshot | null;
}

/**
 * The planner of section 14.6 as the runtime uses it. The core imports nothing from the
 * workspace (plan rule 9), and the neutral snapshots, the track order and the history check live
 * in `@keelwerk/data`, so a deployment lists the planner among its infrastructure and the runtime
 * calls it at `connect` and `migrate`.
 */
export interface SchemaPlanner {
  readonly kind: 'schemaPlanner';
  readonly provides: readonly [];
  /** The neutral snapshot of every track of the entities (`buildTrackSnapshot`). */
  snapshots(
    entries: readonly EntityEntry[],
    options: { readonly trackOfField: (entry: EntityEntry, field: string) => string },
  ): ReadonlyMap<string, TrackSnapshot>;
  /** The run order of tracks (`orderTracks`). */
  orderTracks(
    modules: readonly {
      readonly id: string;
      readonly requires: readonly string[];
      readonly optional: readonly string[];
    }[],
    tracks: readonly string[],
  ): readonly string[];
  /** Whether a track is active for an app that selects these modules (`isTrackActive`). */
  isTrackActive(track: string, selected: readonly string[]): boolean;
  /** The tracks of a module package's `migrations` directory (`loadMigrations`). */
  loadTracks(module: string, migrations: URL): Promise<readonly SchemaTrack[]>;
  /** Applies the pending files under the namespace lock; drift refuses (`applyPending`). */
  applyPending(
    schema: SchemaOperations,
    namespace: NamespaceRef,
    tracks: readonly { readonly track: string; readonly files: readonly MigrationFile[] }[],
  ): Promise<{
    readonly applied: readonly { readonly track: string; readonly id: string }[];
    readonly deferred: readonly { readonly track: string; readonly id: string }[];
  }>;
  /** What differs between an applied history and the committed files (`checkMigrationHistory`). */
  checkHistory(
    history: readonly AppliedMigration[],
    tracks: readonly { readonly track: string; readonly files: readonly MigrationFile[] }[],
  ): readonly string[];
}
