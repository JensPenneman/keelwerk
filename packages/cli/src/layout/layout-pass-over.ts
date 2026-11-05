import { checkMounts } from './check-mounts.ts';
import { checkNames } from './check-names.ts';
import { checkPackages } from './check-packages.ts';
import { checkPlacement } from './check-placement.ts';
import type { LayoutFinding } from './layout-finding.ts';
import type { LayoutWorkspace } from './layout-workspace.ts';

function order(a: LayoutFinding, b: LayoutFinding): number {
  if (a.path !== b.path) return a.path < b.path ? -1 : 1;
  return a.message < b.message ? -1 : a.message > b.message ? 1 : 0;
}

/** The layout pass over a workspace that is already loaded; findings sorted by path and message. */
export async function layoutPassOver(
  workspace: LayoutWorkspace,
): Promise<readonly LayoutFinding[]> {
  return [
    ...checkPlacement(workspace.modules),
    ...checkNames(workspace),
    ...(await checkMounts(workspace)),
    ...checkPackages(workspace),
  ].toSorted(order);
}
