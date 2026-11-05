import type { FallbackReporter } from '@keelwerk/core';
import { fallbackReport } from '@keelwerk/data';
import type { PlacementFact } from './deployment-facts.ts';
import type { DoctorFinding } from './doctor-finding.ts';
import { findingOf } from './finding-of.ts';

/**
 * The data layer's fallbacks (section 14.3.3): per placement, every capability its adapter lacks
 * that a selected app uses, the kernel path that replaces it and what that costs. `reporter` is the
 * deployment's `FallbackReporter` entry, else the table of `@keelwerk/data`. A placement doctor has
 * no capabilities for (it did not open the adapter) is named, not guessed at. `used` limits the rows
 * to the capabilities the apps lean on; undefined lists every absent capability.
 */
export function checkFallbacks(
  placements: readonly PlacementFact[],
  reporter: FallbackReporter | undefined,
  used: ReadonlySet<string> | undefined,
): readonly DoctorFinding[] {
  const report =
    reporter === undefined
      ? fallbackReport
      : (capabilities: Parameters<typeof fallbackReport>[0]) => reporter.report(capabilities);
  const found: DoctorFinding[] = [];
  for (const placement of placements) {
    if (placement.capabilities === undefined) {
      found.push(
        findingOf(
          'fallbacks',
          'note',
          placement.name,
          `the ${placement.adapter} adapter was not opened, so its fallbacks are unknown`,
          'run doctor against a running deployment',
        ),
      );
      continue;
    }
    for (const row of report(placement.capabilities)) {
      if (used !== undefined && !used.has(row.capability)) continue;
      found.push(
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
    }
  }
  return found;
}
