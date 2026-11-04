import type { FallbackReporter } from '@keelwerk/core';
import { fallbackReport } from '@keelwerk/data';

/** The fallback report of `@keelwerk/data` as the infrastructure entry the runtime asks for. */
export function fallbackReporter(): FallbackReporter {
  return {
    kind: 'fallbackReporter',
    provides: [],
    report: (capabilities) => fallbackReport(capabilities),
  };
}
