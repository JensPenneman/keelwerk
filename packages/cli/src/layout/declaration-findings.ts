import { declarationListings } from './declaration-listings.ts';
import { locateFile } from './file-location.ts';
import { importAndEntry } from './import-and-entry.ts';
import type { LayoutFinding } from './layout-finding.ts';
import type { ModuleRoot } from './layout-workspace.ts';

/** A declaration file (entity, stream, flag, extension point, contribution or condition) that `base.ts` does not list. */
export function declarationFindings(module: ModuleRoot): readonly LayoutFinding[] {
  const base = module.sources.get('base.ts');
  if (base === undefined) return [];
  const findings: LayoutFinding[] = [];
  for (const [file, source] of module.sources) {
    const location = locateFile(file);
    const { scope, directory } = location;
    let property: string | undefined;
    if (scope !== undefined && directory === undefined) {
      property = scope.section === 'contributions' ? 'contributions' : 'conditions';
    } else if (scope === undefined && directory !== undefined && location.folders.length === 1) {
      property = declarationListings.get(directory);
    } else if (file === 'config.ts') {
      property = 'config';
    }
    if (property === undefined) continue;
    const name = source.values[0]?.name ?? source.types[0];
    if (name === undefined || base.referenced.has(name)) continue;
    findings.push({
      kind: 'mounts',
      path: `${module.sourceDir}/${file}`,
      message: `${file} declares ${name}, which base.ts does not list`,
      fix: importAndEntry(
        `${module.sourceDir}/base.ts`,
        `${module.sourceDir}/${file}`,
        name,
        `${property} in base.ts`,
      ),
    });
  }
  return findings;
}
