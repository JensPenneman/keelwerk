import { join } from 'node:path';
import type { ApiSurface } from '@keelwerk/core';
import { canonicalizeJson, diffSurfaces, parseApiVersionLedger } from '@keelwerk/core';
import type { AppDerivation } from '../../producers/app-derivation.ts';
import { readIfPresent } from '../../producers/read-if-present.ts';
import { shownPath } from '../../producers/shown-path.ts';
import type { SurfaceDiffEntry } from './surface-diff-entry.ts';
import type { SurfaceDiffReport } from './surface-diff-report.ts';

/** Reads a file of the workspace as it was at the base; undefined when the base has no such file. */
export type ReadBase = (path: string) => Promise<string | undefined>;

/**
 * Compares every API version of each app, derived from the working tree, with the surface the
 * base committed under `generated/api-surface/<app>/<version>.json` (section 18.6): a breaking
 * change fails whatever the changelog says, a dangerous one is reported, a version the base has
 * and the app no longer declares fails unless it lies below the oldest declared one (the floor rule of section 18.2), and
 * every released ledger entry of the base must be unchanged. An app the base lacks is new.
 */
export async function compareWithBase(input: {
  readonly root: string;
  readonly apps: readonly AppDerivation[];
  readonly readBase: ReadBase;
}): Promise<SurfaceDiffReport> {
  const changes: SurfaceDiffEntry[] = [];
  const failures: string[] = [];
  const notes: string[] = [];
  for (const app of input.apps) {
    const directory = join(app.directory, 'generated', 'api-surface', app.app.id);
    const baseLedgerText = await input.readBase(
      shownPath(input.root, join(directory, 'ledger.json')),
    );
    if (baseLedgerText === undefined) {
      notes.push(`${app.app.id}: the base has no ledger for this app, so every version is new`);
      continue;
    }
    const baseLedger = parseApiVersionLedger(baseLedgerText);
    for (const entry of baseLedger.versions) {
      const text = await input.readBase(
        shownPath(input.root, join(directory, `${entry.version}.json`)),
      );
      if (text === undefined) continue;
      const index = app.dates.indexOf(entry.version);
      const head = app.surfaces[index];
      if (head === undefined) {
        const oldest = app.dates[0];
        if (oldest !== undefined && entry.version < oldest) {
          notes.push(`${app.app.id} ${entry.version}: retired by raising the floor`);
        } else {
          failures.push(
            `${app.app.id} ${entry.version}: the version is on the base and no longer declared; a version goes only when the app raises its floor (section 18.2)`,
          );
        }
        continue;
      }
      for (const change of diffSurfaces(JSON.parse(text) as ApiSurface, head)) {
        changes.push({ app: app.app.id, version: entry.version, change });
        const line = `${app.app.id} ${entry.version}: ${change.ref}: ${change.message}`;
        if (change.class === 'breaking') failures.push(`breaking ${line}`);
        else if (change.class === 'dangerous') notes.push(`dangerous ${line}`);
      }
    }
    const currentText = await readIfPresent(join(directory, 'ledger.json'));
    const current = currentText === undefined ? undefined : parseApiVersionLedger(currentText);
    for (const released of baseLedger.versions.slice(0, -1)) {
      const now = current?.versions.find((entry) => entry.version === released.version);
      if (now === undefined || canonicalizeJson(now) !== canonicalizeJson(released)) {
        failures.push(
          `${app.app.id}: the released ledger entry ${released.version} changed; released entries stay as they were (section 18.6)`,
        );
      }
    }
  }
  return { changes, failures, notes };
}
