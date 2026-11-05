import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { TrackPlan } from '@keelwerk/data';
import { renderMigrationFile, renderSnapshot } from '@keelwerk/data';

/** Writes a planned track into its directory: the files, then the snapshot; answers the file names written. */
export async function writeTrackPlan(
  directory: string,
  plan: TrackPlan,
): Promise<readonly string[]> {
  await mkdir(directory, { recursive: true });
  const names: string[] = [];
  for (const file of plan.files) {
    await writeFile(join(directory, `${file.id}.ts`), renderMigrationFile(file));
    names.push(`${file.id}.ts`);
  }
  await writeFile(join(directory, 'snapshot.json'), renderSnapshot(plan.snapshot));
  names.push('snapshot.json');
  return names;
}
