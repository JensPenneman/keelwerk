import type { LayoutFinding } from './layout-finding.ts';
import type { LayoutWorkspace, ModuleRoot } from './layout-workspace.ts';

/** A module package whose `exports` is not its entry: the generated manifest, or the `module.ts` of a sugar module. */
export function entryFindings(
  workspace: LayoutWorkspace,
  module: ModuleRoot,
): readonly LayoutFinding[] {
  const owner = workspace.packages.find((candidate) => candidate.dir === module.dir);
  if (owner === undefined) return [];
  const wanted = module.sugar ? './src/module.ts' : './src/module.generated.ts';
  const exports = owner.manifest.exports as Record<string, unknown> | undefined;
  const entry = exports?.['.'] as Record<string, unknown> | string | undefined;
  const source = typeof entry === 'string' ? entry : entry?.['@keelwerk/source'];
  const extra = Object.keys(exports ?? {}).filter((key) => key !== '.');
  const findings: LayoutFinding[] = [];
  if (source !== wanted) {
    findings.push({
      kind: 'packages',
      path: `${module.dir}/package.json`,
      message: `exports "." resolves to ${typeof source === 'string' ? source : 'nothing'} under the source condition, not ${wanted}`,
      fix: `point "." at ${wanted} under @keelwerk/source and at dist/src/ otherwise`,
    });
  }
  if (extra.length > 0) {
    findings.push({
      kind: 'packages',
      path: `${module.dir}/package.json`,
      message: `a module package has one entry, but exports also lists ${extra.join(', ')}`,
      fix: 'remove the other entries from exports',
    });
  }
  return findings;
}
