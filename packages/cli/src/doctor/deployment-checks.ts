import { capabilitiesUsed } from './capabilities-used.ts';
import { checkAnchors } from './check-anchors.ts';
import { checkDeployment } from './check-deployment.ts';
import { checkFallbacks } from './check-fallbacks.ts';
import { checkHealth } from './check-health.ts';
import { checkPersonalFields } from './check-personal-fields.ts';
import { checkQueuesWithoutWorkers } from './check-queues-without-workers.ts';
import type { DeploymentInput } from './deployment-input.ts';
import type { DoctorFinding } from './doctor-finding.ts';
import { fallbackReporterOf } from './fallback-reporter-of.ts';
import { readDeploymentFacts } from './read-deployment-facts.ts';

/** The deployment checks of section 13.12 over the facts of one deployment. */
export async function deploymentChecks(
  input: DeploymentInput,
  now: Temporal.Instant,
): Promise<readonly DoctorFinding[]> {
  const facts = await readDeploymentFacts(input);
  return [
    ...checkDeployment(facts),
    ...checkFallbacks(
      [facts.control, ...facts.placements],
      fallbackReporterOf(input.definition.infrastructure),
      input.registries.length === 0 ? undefined : capabilitiesUsed(input.registries),
    ),
    ...checkQueuesWithoutWorkers(facts.queues),
    ...checkAnchors(facts.anchors, now),
    ...checkPersonalFields(facts.personal),
    ...checkHealth(facts.processes, input.reader !== undefined),
  ];
}
