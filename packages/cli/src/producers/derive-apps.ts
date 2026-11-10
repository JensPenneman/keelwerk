import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ExpectedLedgerEntry } from '@keelwerk/core';
import { coreApiVersions, deriveSurface, pascal } from '@keelwerk/core';
import type { AppDerivation } from './app-derivation.ts';
import type { DerivedApps } from './derived-apps.ts';
import { findRoots } from './find-roots.ts';
import { loadApp } from './load-app.ts';
import { shownPath } from './shown-path.ts';

/**
 * Loads every app root of the workspace and derives its surface at each declared API version
 * (sections 13.7 and 18.2). An app that exports no app value, lacks its named type or derives with
 * an error problem is a failure of its own and is left out of `apps`.
 */
export async function deriveApps(
  root: string,
  progress: (done: string) => void = () => undefined,
): Promise<DerivedApps> {
  const apps: AppDerivation[] = [];
  const failures: string[] = [];
  const notes: string[] = [];
  for (const directory of await findRoots(root, 'app')) {
    const shown = shownPath(root, directory);
    const appFile = join(directory, 'src', 'app.ts');
    let app: Awaited<ReturnType<typeof loadApp>>;
    try {
      app = await loadApp(appFile);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(`${shown}: src/app.ts cannot be loaded: ${message}`);
      progress(`could not load ${shown}`);
      continue;
    }
    progress(`loaded ${shown}`);
    if (app === undefined) {
      failures.push(`${shown}: src/app.ts exports no app value`);
      continue;
    }
    const appType = pascal(app.id);
    if (
      !new RegExp(`export (interface|type) ${appType}\\b`).test(await readFile(appFile, 'utf8'))
    ) {
      failures.push(`${shown}: src/app.ts must export the type ${appType} of the app`);
      continue;
    }
    const dates = app.api?.dates ?? coreApiVersions.dates;
    const surfaces = [];
    const implied: ExpectedLedgerEntry[] = [];
    let broken = false;
    for (const date of dates) {
      const derived = deriveSurface(app, date);
      for (const problem of derived.problems) {
        const line = `${shown}: ${problem.severity} ${problem.code}: ${problem.message}`;
        if (problem.severity === 'error') {
          failures.push(line);
          broken = true;
        } else {
          notes.push(line);
        }
      }
      surfaces.push(derived.surface);
      implied.push({
        version: date,
        surfaceHash: derived.surface.hash,
        modules: Object.fromEntries(derived.surface.modules.map((item) => [item.id, item.version])),
      });
    }
    if (!broken) apps.push({ directory, shown, app, appType, dates, surfaces, implied });
  }
  return { apps, failures, notes };
}
