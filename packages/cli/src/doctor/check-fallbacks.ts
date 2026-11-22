import { fallbackReport } from '@keelwerk/data';
import { definePlacementCheck } from './define-placement-check.ts';
import type { DeploymentCheck } from './deployment-check.ts';
import { findingOf } from './finding-of.ts';

/**
 * The data layer's fallbacks (section 14.3.3): per placement, the control store included, every
 * capability its adapter lacks that a selected app uses, the kernel path that replaces it and what
 * that costs. The report is the deployment's `FallbackReporter` entry, else the table of
 * `@keelwerk/data`. The rows are limited to the capabilities the apps lean on; with no app composed
 * every absent capability is listed. A placement doctor could not open is 'not-checked'.
 */
export const fallbacksCheck: DeploymentCheck = definePlacementCheck({
  group: 'fallbacks',
  name: 'fallbacks',
  needs: ['fallbackReporter', 'capabilitiesUsed'],
  judge: ({ fallbackReporter, capabilitiesUsed }, placement) => {
    const rows =
      fallbackReporter === undefined
        ? fallbackReport(placement.capabilities)
        : fallbackReporter.report(placement.capabilities);
    return rows
      .filter((row) => capabilitiesUsed === undefined || capabilitiesUsed.has(row.capability))
      .map((row) =>
        findingOf(
          'fallbacks',
          row.capability === 'rowLevelSecurity' ? 'warning' : 'note',
          placement.name,
          `${row.capability} is absent: the kernel runs ${row.path}; cost: ${row.cost}`,
          row.capability === 'rowLevelSecurity'
            ? 'run the adversarial isolation suite against this placement (section 14.10)'
            : 'none needed; use an adapter that has the capability to remove the cost',
        ),
      );
  },
});
