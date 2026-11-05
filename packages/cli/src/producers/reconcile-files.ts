import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { writeModuleManifest } from '@keelwerk/core/manifest';
import type { ProducerFile } from './producer-file.ts';
import type { ProducerResult } from './producer-result.ts';
import { readIfPresent } from './read-if-present.ts';
import { shownPath } from './shown-path.ts';
import { withoutProducerVersion } from './without-producer-version.ts';

/**
 * Brings the files on disk to the text the producer implies, or with `check` only says which ones
 * differ. A file that changes the way a release does (the producer's version alone) is no drift.
 */
export async function reconcileFiles(
  root: string,
  files: readonly ProducerFile[],
  check: boolean,
): Promise<ProducerResult> {
  const written: string[] = [];
  const failures: string[] = [];
  for (const file of files) {
    const name = shownPath(root, file.path);
    if (check) {
      const committed = await readIfPresent(file.path);
      if (committed === undefined) {
        failures.push(`${name} does not exist; run keelwerk generate`);
      } else if (withoutProducerVersion(committed) !== withoutProducerVersion(file.text)) {
        failures.push(`${name} has drifted; run keelwerk generate`);
      }
    } else {
      await mkdir(dirname(file.path), { recursive: true });
      if (await writeModuleManifest(file.path, file.text)) written.push(name);
    }
  }
  return { written, notes: [], failures };
}
