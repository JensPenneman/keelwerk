import type { DeploymentFacts } from './deployment-facts.ts';
import type { DoctorFinding } from './doctor-finding.ts';
import { findingOf } from './finding-of.ts';

/** A module that needs a raw-SQL dialect (`data.needs`, section 14.3.8) which the adapter of a placement lacks. */
export function sqlNeedsFindings(facts: DeploymentFacts): readonly DoctorFinding[] {
  const found: DoctorFinding[] = [];
  for (const need of facts.sqlNeeds) {
    for (const placement of facts.placements) {
      const offered = placement.capabilities?.sql;
      if (
        placement.capabilities === undefined ||
        (offered !== false && offered?.dialect === need.dialect)
      )
        continue;
      found.push(
        findingOf(
          'deployment',
          'error',
          placement.name,
          `module ${need.module} needs raw SQL (${need.dialect}) and the ${placement.adapter} adapter of placement ${placement.name} offers ${offered === false || offered === undefined ? 'none' : offered.dialect}`,
          `place the module's app on a ${need.dialect} placement`,
        ),
      );
    }
  }
  return found;
}
