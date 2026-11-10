import type { LayoutWorkspace } from '../layout/layout-workspace.ts';
import type { DeploymentFacts } from './deployment-facts.ts';
import type { DeploymentInput } from './deployment-input.ts';
import type { DoctorFinding } from './doctor-finding.ts';
import type { ProjectChecksInput } from './project-checks-input.ts';

/**
 * The M2 doctor checks, one entry per `check-<name>.ts`: deployment checks after M1's, project
 * checks before the layout pass.
 */
export const m2Checks: {
  readonly deployment: readonly ((
    input: DeploymentInput,
    facts: DeploymentFacts,
    now: Temporal.Instant,
  ) => Promise<readonly DoctorFinding[]>)[];
  readonly project: readonly ((
    input: ProjectChecksInput,
    workspace: LayoutWorkspace,
  ) => Promise<readonly DoctorFinding[]>)[];
} = { deployment: [], project: [] };
