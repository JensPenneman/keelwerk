import { entryFindings } from './entry-findings.ts';
import type { LayoutFinding } from './layout-finding.ts';
import type { LayoutWorkspace } from './layout-workspace.ts';
import { missingNamedTypes } from './missing-named-types.ts';
import { referenceFindings } from './reference-findings.ts';
import { rootReferenceFindings } from './root-reference-findings.ts';

/** Packages (section 23.13): the entry of a module package, missing named types, missing references to modules named in the base, and packages the root `tsconfig.json` does not reference. */
export function checkPackages(workspace: LayoutWorkspace): readonly LayoutFinding[] {
  const findings: LayoutFinding[] = [];
  for (const module of workspace.modules) {
    findings.push(...entryFindings(workspace, module), ...referenceFindings(workspace, module));
    const base = module.sources.get('base.ts');
    if (base !== undefined) findings.push(...missingNamedTypes(base));
    if (module.entry !== undefined) findings.push(...missingNamedTypes(module.entry));
  }
  for (const app of workspace.apps) {
    const source = app.sources.get('app.ts');
    if (source !== undefined) findings.push(...missingNamedTypes(source));
  }
  findings.push(...rootReferenceFindings(workspace));
  return findings;
}
