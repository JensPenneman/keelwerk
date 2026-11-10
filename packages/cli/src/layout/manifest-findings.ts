import { join } from 'node:path';
import {
  checkModuleManifest,
  renderModuleManifest,
  scanModuleDirectory,
} from '@keelwerk/core/manifest';
import type { LayoutFinding } from './layout-finding.ts';
import type { ModuleRoot } from './layout-workspace.ts';

const PLACEMENT_REASONS: ReadonlySet<string> = new Set([
  'no convention places a file in this directory',
  'no convention places a file here',
]);

/** The generated manifest against the directories (what `keelwerk generate --check` compares) and the files that would stay unmounted. */
export async function manifestFindings(
  root: string,
  module: ModuleRoot,
): Promise<readonly LayoutFinding[]> {
  if (module.sugar || module.id === undefined) return [];
  const scanned = scanModuleDirectory(module.files);
  const findings: LayoutFinding[] = [];
  for (const file of scanned.unplaced) {
    if (PLACEMENT_REASONS.has(file.reason)) continue;
    findings.push({
      kind: 'mounts',
      path: `${module.sourceDir}/${file.path}`,
      message: `${file.path} stays unmounted: ${file.reason}`,
      fix: 'move or rename the file so a convention of section 23.5 places it',
    });
  }
  const text = renderModuleManifest({
    id: module.id,
    scanned,
    migrations: module.hasMigrations,
  });
  const checked = await checkModuleManifest(
    join(root, module.sourceDir, 'module.generated.ts'),
    module.id,
    text,
  );
  for (const problem of checked.problems) {
    findings.push({
      kind: 'mounts',
      path: `${module.sourceDir}/module.generated.ts`,
      message: problem,
      fix: 'run keelwerk generate (pnpm manifests) to rewrite the manifest',
    });
  }
  return findings;
}
