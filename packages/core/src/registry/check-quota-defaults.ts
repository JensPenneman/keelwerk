import { parseQuotaValue } from '../quotas/parse-quota-value.ts';
import type { ComposableApp } from './composable-app.ts';
import { compositionError } from './composition-error.ts';
import type { CompositionProblem } from './composition-problem.ts';
import type { Registry } from './registry.ts';

/**
 * `quotaDefaultInvalid`: the declared default of a quota must parse for the dimension's kind, so
 * resolution never meets a default it cannot read.
 */
export function checkQuotaDefaults(
  _app: ComposableApp,
  registry: Registry,
): readonly CompositionProblem[] {
  const problems: CompositionProblem[] = [];
  for (const entry of registry.quotas.values()) {
    try {
      parseQuotaValue(entry.kind, entry.default);
    } catch (error) {
      problems.push(
        compositionError(
          'quotaDefaultInvalid',
          `The default of the quota '${entry.ref}' is refused: ${error instanceof Error ? error.message : 'it does not parse'}`,
          { module: entry.module, ref: entry.ref },
        ),
      );
    }
  }
  return problems;
}
