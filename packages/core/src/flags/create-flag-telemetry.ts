import type { Meter } from '../observability/meter.ts';
import type { FlagTelemetry } from './flag-telemetry.ts';
import { telemetryVariantOf } from './telemetry-variant-of.ts';

/** The flag counter over a meter; the counter is created once. */
export function createFlagTelemetry(meter: Meter): FlagTelemetry {
  const counter = meter.createCounter('keelwerk.flags.evaluations', {
    description: 'Flag evaluations by flag, variant and reason.',
  });
  return {
    evaluated: (flag, resolution, scope) => {
      counter.add(1, {
        flag: flag.key,
        variant: telemetryVariantOf(flag, resolution),
        reason: resolution.reason,
        ...(scope.level === 'deployment' ? {} : { backend: scope.backendId }),
      });
    },
  };
}
