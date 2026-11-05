import type { LayoutFinding } from './layout-finding.ts';
import { layoutPassOver } from './layout-pass-over.ts';
import { loadWorkspace } from './load-workspace.ts';

/**
 * The layout pass of `keelwerk doctor` (section 23.13): reads the sources under `root` with
 * TypeScript 6.0.3's compiler API, compares them with the conventions and the generated manifests,
 * and names a fix per finding. It never edits.
 */
export async function layoutPass(root: string): Promise<readonly LayoutFinding[]> {
  const workspace = await loadWorkspace(root);
  return layoutPassOver(workspace);
}
