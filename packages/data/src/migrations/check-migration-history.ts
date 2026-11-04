import type { AppliedMigration, MigrationFile } from '@keelwerk/core';
import { migrationChecksum } from './migration-checksum.ts';

/** A track's files as the history is checked against them. */
export interface TrackFiles {
  readonly track: string;
  readonly files: readonly MigrationFile[];
}

/**
 * Compares an applied history with the committed files of the given (active) tracks (section
 * 14.6.3): a file whose checksum changed after it was applied, and an applied file the track no
 * longer has, are drift. Rows of tracks that are not given are inactive tracks and stay unchecked.
 */
export function checkMigrationHistory(
  history: readonly AppliedMigration[],
  tracks: readonly TrackFiles[],
): readonly string[] {
  const problems: string[] = [];
  for (const { track, files } of tracks) {
    for (const row of history) {
      if (row.track !== track) continue;
      const file = files.find((candidate) => candidate.id === row.id);
      if (file === undefined) {
        problems.push(`${track} ${row.id} was applied but its file is gone`);
      } else if (migrationChecksum(file.steps) !== row.checksum) {
        problems.push(`${track} ${row.id} changed after it was applied`);
      }
    }
  }
  return problems;
}
