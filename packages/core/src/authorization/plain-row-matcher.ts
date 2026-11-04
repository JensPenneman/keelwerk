import { evaluateCondition } from '../conditions/evaluate-condition.ts';
import type { EvaluateOptions } from '../conditions/evaluate-options.ts';
import type { RowMatcher } from './row-matcher.ts';

/** A matcher for conditions without relation quantifiers (it throws on one). */
export function plainRowMatcher(options: Omit<EvaluateOptions, 'matching'> = {}): RowMatcher {
  return (condition, row) => evaluateCondition(condition, row, options);
}
