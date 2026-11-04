import type { CompositionProblem } from './composition-problem.ts';

/** Where a problem was found: the module and the reference it concerns. */
export interface ProblemSite {
  readonly module?: string;
  readonly ref?: string;
}

/** An error-severity problem; `defineApp` refuses an app with any of these. */
export function compositionError(
  code: string,
  message: string,
  site: ProblemSite = {},
): CompositionProblem {
  return {
    code,
    severity: 'error',
    message,
    ...(site.module === undefined ? {} : { module: site.module }),
    ...(site.ref === undefined ? {} : { ref: site.ref }),
  };
}
