import type { RuleMatch } from '../errors/rule-match.ts';

/** The gate's answer (section 8.4): cheap, a boolean with the rules behind it. */
export interface GateResult {
  readonly allowed: boolean;
  /** Allowed: the allow rules in effect. Denied: the deciding deny rules, or the allows that would have had to hold. */
  readonly rules: readonly RuleMatch[];
  /** Why a gate check other than a rule denied, or the deciding deny rule's reason. */
  readonly reason: string | undefined;
}
