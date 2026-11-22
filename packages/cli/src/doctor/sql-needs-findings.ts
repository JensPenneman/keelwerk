import { definePlacementCheck } from './define-placement-check.ts';
import type { DeploymentCheck } from './deployment-check.ts';
import type { SqlNeedFact } from './deployment-facts.ts';
import { findingOf } from './finding-of.ts';

/**
 * A module that needs a raw-SQL dialect (`data.sql`, section 14.3.8) which the adapter of a
 * placement that hosts its app lacks.
 */
export const sqlNeedsCheck: DeploymentCheck = definePlacementCheck({
  group: 'deployment',
  name: 'raw-SQL needs',
  needs: ['sqlNeeds'],
  concerns: ({ sqlNeeds }, placement) => sqlNeeds.some((need) => placement.apps.includes(need.app)),
  judge: ({ sqlNeeds }, placement) => {
    const offered = placement.capabilities.sql;
    const offers = offered === false ? 'none' : offered.dialect;
    const unmet = new Map<string, SqlNeedFact>();
    for (const need of sqlNeeds) {
      if (placement.apps.includes(need.app) && need.dialect !== offers) {
        unmet.set(`${need.module}|${need.dialect}`, need);
      }
    }
    return [...unmet.values()].map((need) =>
      findingOf(
        'deployment',
        'error',
        placement.name,
        `module ${need.module} needs raw SQL (${need.dialect}) and the ${placement.adapter} adapter of placement ${placement.name} offers ${offers}`,
        `place the module's app on a ${need.dialect} placement`,
      ),
    );
  },
});
