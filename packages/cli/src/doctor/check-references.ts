import { posix } from 'node:path';
import type { LayoutWorkspace } from '../layout/layout-workspace.ts';
import type { DoctorFinding } from './doctor-finding.ts';
import { findingOf } from './finding-of.ts';
import { inProjectScope } from './project-package-scope.ts';

function referencesOf(
  tsconfig: Readonly<Record<string, unknown>> | undefined,
  dir: string,
): readonly string[] {
  const list = Array.isArray(tsconfig?.references) ? tsconfig.references : [];
  return list.flatMap((entry) => {
    const path = (entry as { path?: unknown } | null)?.path;
    return typeof path === 'string'
      ? [posix.normalize(posix.join(dir, path)).replace(/\/tsconfig[^/]*\.json$/, '')]
      : [];
  });
}

/** Project references are complete (section 13.12): every workspace dependency of a package is referenced, computed from `package.json`. */
export function checkReferences(workspace: LayoutWorkspace): readonly DoctorFinding[] {
  const found: DoctorFinding[] = [];
  for (const owner of workspace.packages) {
    if (!inProjectScope(owner.dir) || owner.tsconfig === undefined) continue;
    const referenced = referencesOf(owner.tsconfig, owner.dir);
    for (const key of ['dependencies', 'peerDependencies']) {
      const dependencies = (owner.manifest[key] ?? {}) as Record<string, unknown>;
      for (const [name, spec] of Object.entries(dependencies)) {
        if (typeof spec !== 'string' || !spec.startsWith('workspace:')) continue;
        const target = workspace.packages.find((candidate) => candidate.manifest.name === name);
        if (
          target === undefined ||
          target.tsconfig === undefined ||
          referenced.includes(target.dir)
        )
          continue;
        found.push(
          findingOf(
            'references',
            'error',
            `${owner.dir}/tsconfig.json`,
            `${name} is a workspace dependency but is not referenced`,
            `add { "path": "${posix.relative(owner.dir, target.dir)}" } to references`,
          ),
        );
      }
    }
  }
  return found;
}
