import type { CompositionProblem } from '../registry/composition-problem.ts';
import type { RuleEntry } from '../registry/rule-entry.ts';

/** The rule set after the app's overrides. */
export interface OverriddenRules {
  /** Every rule, with the switched-off ones marked `disabled`. */
  readonly rules: readonly RuleEntry[];
  readonly problems: readonly CompositionProblem[];
}
