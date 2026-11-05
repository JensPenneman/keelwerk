import type { TrackSnapshot } from '@keelwerk/core';
import type { TrackMigrations } from '@keelwerk/data';

/** A migration track of the workspace: where it lies, what the definitions describe now, and what is committed. */
export interface MigrationTarget {
  readonly track: string;
  /** The module whose package ships the track. */
  readonly module: string;
  /** The app whose definitions were read. */
  readonly app: string;
  /** `<module root>/migrations/<track directory>`, absolute. */
  readonly directory: string;
  /** The snapshot the definitions describe now (version and rename history carried over). */
  readonly desired: TrackSnapshot;
  /** The track as committed; its snapshot is null before its first file. */
  readonly committed: TrackMigrations;
}
