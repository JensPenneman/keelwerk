import { appMountFindings } from './app-mount-findings.ts';
import { declarationFindings } from './declaration-findings.ts';
import type { LayoutFinding } from './layout-finding.ts';
import type { LayoutWorkspace } from './layout-workspace.ts';
import { manifestFindings } from './manifest-findings.ts';

/** Mounts (section 23.13): a manifest out of date, a file that stays unmounted, a declaration `base.ts` does not list, an app-level part `app.ts` does not mount. */
export async function checkMounts(workspace: LayoutWorkspace): Promise<readonly LayoutFinding[]> {
  const findings: LayoutFinding[] = [];
  for (const module of workspace.modules) {
    findings.push(
      ...(await manifestFindings(workspace.root, module)),
      ...declarationFindings(module),
    );
  }
  for (const app of workspace.apps) findings.push(...appMountFindings(app));
  return findings;
}
