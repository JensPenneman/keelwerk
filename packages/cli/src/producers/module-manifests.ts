import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { camelFromKebab } from '@keelwerk/core';
import {
  checkModuleManifest,
  renderModuleManifest,
  scanModuleDirectory,
  writeModuleManifest,
} from '@keelwerk/core/manifest';
import { findRoots } from './find-roots.ts';
import type { ProducerResult } from './producer-result.ts';
import { shownPath } from './shown-path.ts';

async function listing(source: string): Promise<string[]> {
  const entries = await readdir(source, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => relative(source, join(entry.parentPath, entry.name)).split(sep).join('/'));
}

/**
 * `src/module.generated.ts` of every module root in the workspace (sections 13.7 and 23.5), written
 * from the directory conventions, or with `check` compared with them. A moved part file changes its
 * reference, and the failure names the module and the reference before and after.
 */
export async function produceModuleManifests(
  root: string,
  check: boolean,
): Promise<ProducerResult> {
  const written: string[] = [];
  const notes: string[] = [];
  const failures: string[] = [];
  for (const moduleRoot of await findRoots(root, 'module')) {
    const shown = shownPath(root, moduleRoot);
    const source = join(moduleRoot, 'src');
    const base = await readFile(join(source, 'base.ts'), 'utf8');
    const id = /\bid:\s*'([a-z][a-z0-9]*(?:-[a-z0-9]+)*)'/.exec(base)?.[1];
    if (id === undefined || !base.includes(`export const ${camelFromKebab(id)}Base`)) {
      failures.push(`${shown}: src/base.ts must declare a literal id and export <id>Base`);
      continue;
    }
    const scanned = scanModuleDirectory(await listing(source));
    for (const file of scanned.unplaced) {
      notes.push(`${shown}: ${file.path} stays unmounted: ${file.reason}`);
    }
    const text = renderModuleManifest({
      id,
      scanned,
      migrations: existsSync(join(moduleRoot, 'migrations')),
    });
    const target = join(source, 'module.generated.ts');
    if (check) {
      const result = await checkModuleManifest(target, id, text);
      failures.push(...result.problems);
    } else if (await writeModuleManifest(target, text)) {
      written.push(`${shown}/src/module.generated.ts`);
    }
  }
  return { written, notes, failures };
}
