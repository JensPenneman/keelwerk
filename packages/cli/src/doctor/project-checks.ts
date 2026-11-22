import { layoutPassOver } from '../layout/layout-pass-over.ts';
import { loadWorkspace } from '../layout/load-workspace.ts';
import { checkArtefacts } from './check-artefacts.ts';
import { checkDeclarationSizes } from './check-declaration-sizes.ts';
import { checkEnvironment } from './check-environment.ts';
import { checkNamedTypes } from './check-named-types.ts';
import { checkPackageManifests } from './check-package-manifests.ts';
import { checkReferences } from './check-references.ts';
import { checkTsconfigs } from './check-tsconfigs.ts';
import type { DoctorFinding } from './doctor-finding.ts';
import { layoutFindingsOf } from './layout-findings-of.ts';
import type { ProjectChecksInput } from './project-checks-input.ts';

function unique(findings: readonly DoctorFinding[]): readonly DoctorFinding[] {
  const seen = new Set<string>();
  return findings.filter((finding) => {
    const key = `${finding.subject}|${finding.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** The environment and project checks of section 13.12, the layout pass last. */
export async function projectChecks(input: ProjectChecksInput): Promise<readonly DoctorFinding[]> {
  const workspace = await loadWorkspace(input.root);
  return unique([
    ...checkEnvironment(input.environment),
    ...(await checkTsconfigs(workspace)),
    ...checkReferences(workspace),
    ...checkPackageManifests(workspace),
    ...(await checkArtefacts(input.root, input.runArtefacts)),
    ...checkNamedTypes(workspace),
    ...(await checkDeclarationSizes(workspace)),
    ...layoutFindingsOf(await layoutPassOver(workspace)),
  ]);
}
