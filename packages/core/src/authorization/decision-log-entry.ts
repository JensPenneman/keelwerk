import type { RuleMatch } from '../errors/rule-match.ts';
import type { PrincipalKind } from '../principals/principal-kind.ts';

/** One authorization decision, as the decision-log hook receives it (section 8.6). */
export interface DecisionLogEntry {
  readonly stage: 'gate' | 'plan' | 'item' | 'shape';
  /** The action reference. */
  readonly action: string;
  readonly entity?: string;
  readonly allowed: boolean;
  readonly rules: readonly RuleMatch[];
  readonly reason?: string;
  readonly principal: { readonly kind: PrincipalKind; readonly via: string };
}
