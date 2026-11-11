import { join } from 'node:path';
import type { ApiVersionLedger } from '@keelwerk/core';
import {
  appendLedgerEntry,
  checkLedger,
  emptyApiVersionLedger,
  parseApiVersionLedger,
  refreshHeadEntry,
  renderApiVersionLedger,
  renderSurfaceArtefact,
} from '@keelwerk/core';
import type { AppDerivation } from './app-derivation.ts';
import { orphanFiles } from './orphan-files.ts';
import type { ProducedFiles } from './produced-files.ts';
import type { ProducerFile } from './producer-file.ts';
import { readIfPresent } from './read-if-present.ts';
import { shownPath } from './shown-path.ts';
import { surfaceDirectory } from './surface-directory.ts';

/**
 * The surface document of each declared API version and the ledger (sections 13.7 and 18.2). The
 * first run creates every ledger entry; later runs follow the sources on the head entry only,
 * since released entries belong to `surface version new` (18.6). With `check` the ledger is not
 * written but compared with `defineApiVersions`, and a missing ledger fails.
 */
export async function produceSurfaces(
  root: string,
  apps: readonly AppDerivation[],
  check: boolean,
): Promise<ProducedFiles> {
  const files: ProducerFile[] = [];
  const failures: string[] = [];
  const notes: string[] = [];
  for (const app of apps) {
    const directory = surfaceDirectory(app);
    const keep = new Set(['ledger.json']);
    app.dates.forEach((date, index) => {
      const surface = app.surfaces[index];
      if (surface === undefined) return;
      keep.add(`${date}.json`);
      files.push({ path: join(directory, `${date}.json`), text: renderSurfaceArtefact(surface) });
    });
    const ledgerPath = join(directory, 'ledger.json');
    const name = shownPath(root, ledgerPath);
    const ledgerText = await readIfPresent(ledgerPath);
    const ledger =
      ledgerText === undefined
        ? emptyApiVersionLedger(app.app.id)
        : parseApiVersionLedger(ledgerText);
    if (check) {
      if (ledgerText === undefined) {
        failures.push(`${name} does not exist; run keelwerk generate`);
      } else {
        for (const problem of checkLedger(
          ledger,
          app.app.id,
          app.implied,
          new Set(app.app.registry.versionChanges.keys()),
        )) {
          failures.push(`${name}: ${problem.code}: ${problem.message}`);
        }
      }
    } else {
      let next: ApiVersionLedger = ledger;
      if (ledgerText === undefined) {
        for (const entry of app.implied)
          next = appendLedgerEntry(next, { ...entry, changes: entry.changes ?? [] });
      } else {
        const head = app.implied.at(-1);
        const recorded = ledger.versions.at(-1)?.version;
        if (head !== undefined && recorded !== head.version) {
          failures.push(
            `${name}: the head entry is '${recorded ?? 'none'}' but the app declares '${head.version}'; ${
              recorded !== undefined && app.dates.includes(recorded)
                ? `run keelwerk surface version new ${head.version}`
                : `add '${head.version}' to defineApiVersions or run keelwerk surface version new ${head.version}`
            }`,
          );
        } else if (head !== undefined) {
          next = refreshHeadEntry(next, head);
        }
      }
      files.push({ path: ledgerPath, text: renderApiVersionLedger(next) });
    }
    const orphans = await orphanFiles(root, directory, keep, app.app.id);
    (check ? failures : notes).push(...orphans);
  }
  return { files, notes, failures };
}
