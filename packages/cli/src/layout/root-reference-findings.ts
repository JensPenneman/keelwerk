import { posix } from 'node:path';
import type { LayoutFinding } from './layout-finding.ts';
import type { LayoutWorkspace } from './layout-workspace.ts';

/** A package with a `tsconfig.json` that the root `tsconfig.json` does not reference. */
export function rootReferenceFindings(workspace: LayoutWorkspace): readonly LayoutFinding[] {
  const root = workspace.rootTsconfig;
  if (root === undefined) return [];
  const listed = new Set(
    (Array.isArray(root.references) ? root.references : []).flatMap((entry) => {
      const path = (entry as { path?: unknown } | null)?.path;
      return typeof path === 'string'
        ? [posix.normalize(path).replace(/\/tsconfig\.json$/, '')]
        : [];
    }),
  );
  return workspace.packages
    .filter((candidate) => candidate.dir !== '' && candidate.tsconfig !== undefined)
    .filter((candidate) => !listed.has(candidate.dir))
    .map((candidate) => ({
      kind: 'packages' as const,
      path: 'tsconfig.json',
      message: `${candidate.dir} is a package that the root tsconfig.json does not reference`,
      fix: `add { "path": "${candidate.dir}" } to the references of tsconfig.json`,
    }));
}
