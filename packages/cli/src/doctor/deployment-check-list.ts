import { deploymentGroup } from './check-deployment.ts';
import { epochBumpsCheck } from './check-epoch-bumps.ts';
import { fallbacksCheck } from './check-fallbacks.ts';
import { healthCheck } from './check-health.ts';
import { heldTenantsCheck } from './check-held-tenants.ts';
import { observersCheck } from './check-observers.ts';
import { personalFieldsCheck } from './check-personal-fields.ts';
import type { DeploymentCheck } from './deployment-check.ts';
import { sqlNeedsCheck } from './sql-needs-findings.ts';
import { unfedChecks } from './unfed-checks.ts';

/** Every deployment check of section 13.12, in the order their findings print: the one list the runner works through. */
export const deploymentCheckList: readonly DeploymentCheck[] = [
  ...deploymentGroup,
  sqlNeedsCheck,
  fallbacksCheck,
  ...unfedChecks,
  personalFieldsCheck,
  healthCheck,
  epochBumpsCheck,
  heldTenantsCheck,
  observersCheck,
];
