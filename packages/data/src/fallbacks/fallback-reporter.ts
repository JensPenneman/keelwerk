import type { FallbackReporter } from '@keelwerk/core';
import { fallbackReport } from './fallback-report.ts';

/** The fallback report of this package as the infrastructure entry the runtime asks for. */
export function fallbackReporter(): FallbackReporter {
  return {
    kind: 'fallbackReporter',
    provides: [],
    report: (capabilities) => fallbackReport(capabilities),
  };
}
