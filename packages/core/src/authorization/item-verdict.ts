import type { RuleMatch } from '../errors/rule-match.ts';

/** The outcome of an item check (section 8.4). */
export interface ItemVerdict {
  readonly allowed: boolean;
  /** The rules that decided: the allows that held, the deciding deny, or the allows that would have had to hold. */
  readonly rules: readonly RuleMatch[];
  /** The deciding deny rule's reason. */
  readonly reason: string | undefined;
  /** Changed fields no selecting allow rule lets the write change, or a deny rule forbids. */
  readonly forbiddenFields: readonly string[];
}
