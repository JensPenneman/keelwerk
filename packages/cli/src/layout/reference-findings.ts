import { posix } from 'node:path';
import type { LayoutFinding } from './layout-finding.ts';
import type { LayoutWorkspace, ModuleRoot } from './layout-workspace.ts';
import { moduleReferences } from './module-references.ts';

function listOf(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function referencedDirs(
  tsconfig: Readonly<Record<string, unknown>> | undefined,
  dir: string,
): readonly string[] {
  return listOf(tsconfig?.references).flatMap((entry) => {
    const path = (entry as { path?: unknown } | null)?.path;
    return typeof path === 'string'
      ? [posix.normalize(posix.join(dir, path)).replace(/\/tsconfig[^/]*\.json$/, '')]
      : [];
  });
}

/** A module named in `requires`, `optional`, a target or a `when` list that the package does not depend on or reference. */
export function referenceFindings(
  workspace: LayoutWorkspace,
  module: ModuleRoot,
): readonly LayoutFinding[] {
  const owner = workspace.packages.find((candidate) => candidate.dir === module.dir);
  if (owner === undefined) return [];
  const dependencies = new Set(
    ['dependencies', 'peerDependencies'].flatMap((key) =>
      Object.keys((owner.manifest[key] as Record<string, unknown> | undefined) ?? {}),
    ),
  );
  const referenced = referencedDirs(owner.tsconfig, module.dir);
  const findings: LayoutFinding[] = [];
  const reported = new Set<string>();
  for (const reference of moduleReferences(module)) {
    if (reference.specifier.startsWith('.') || reported.has(reference.specifier)) continue;
    reported.add(reference.specifier);
    if (!dependencies.has(reference.specifier)) {
      findings.push({
        kind: 'packages',
        path: `${module.dir}/package.json`,
        message: `${reference.path} names ${reference.name} (${reference.specifier}), which is not a dependency`,
        fix: `add ${reference.specifier} to dependencies`,
      });
    }
    const target = workspace.packages.find(
      (candidate) => candidate.manifest.name === reference.specifier,
    );
    if (target !== undefined && !referenced.includes(target.dir)) {
      findings.push({
        kind: 'packages',
        path: `${module.dir}/tsconfig.json`,
        message: `${reference.specifier} is named by the module but not referenced`,
        fix: `add { "path": "${posix.relative(module.dir, target.dir)}" } to references`,
      });
    }
  }
  return findings;
}
