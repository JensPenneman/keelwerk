import { deploymentCheckList } from './deployment-check-list.ts';
import type { DeploymentInput } from './deployment-input.ts';
import type { DoctorFinding } from './doctor-finding.ts';
import { readDeploymentFacts } from './read-deployment-facts.ts';
import { runDeploymentChecks } from './run-deployment-checks.ts';

/** The deployment checks of section 13.12 over the facts of one deployment. */
export async function deploymentChecks(input: DeploymentInput): Promise<readonly DoctorFinding[]> {
  return runDeploymentChecks(deploymentCheckList, await readDeploymentFacts(input));
}
