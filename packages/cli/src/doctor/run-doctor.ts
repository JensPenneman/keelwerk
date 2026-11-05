import { layoutPass } from '../layout/layout-pass.ts';
import { deploymentChecks } from './deployment-checks.ts';
import type { DeploymentInput } from './deployment-input.ts';
import type { DoctorFinding } from './doctor-finding.ts';
import { layoutFindingsOf } from './layout-findings-of.ts';
import { projectChecks } from './project-checks.ts';
import type { ProjectChecksInput } from './project-checks-input.ts';

/** What one run of doctor covers. */
export interface DoctorRun extends ProjectChecksInput {
  /** `--layout`: the layout pass alone. */
  readonly layoutOnly: boolean;
  /** The deployment to judge; undefined when there is none to load. */
  readonly deployment: DeploymentInput | undefined;
  readonly now: Temporal.Instant;
}

/** Runs doctor: the layout pass alone, or the environment, the project and, when given, the deployment. */
export async function runDoctor(run: DoctorRun): Promise<readonly DoctorFinding[]> {
  if (run.layoutOnly) return layoutFindingsOf(await layoutPass(run.root));
  const project = await projectChecks(run);
  return run.deployment === undefined
    ? project
    : [...project, ...(await deploymentChecks(run.deployment, run.now))];
}
