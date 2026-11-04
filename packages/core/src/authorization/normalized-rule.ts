import type { PrincipalKind } from '../principals/principal-kind.ts';
import type { RuleEntry } from '../registry/rule-entry.ts';
import type { ExpandedActions } from './expand-action-aliases.ts';

/** What a rule covers. */
export type RuleTarget =
  | { readonly kind: 'entity'; readonly ref: string }
  | { readonly kind: 'module'; readonly module: string }
  | {
      readonly kind: 'selector';
      readonly kinds: readonly ('query' | 'command' | 'subscription')[] | null;
      readonly transports: readonly string[] | null;
    };

/** A rule entry with its target, action list and principal kinds resolved. */
export interface NormalizedRule {
  readonly id: string;
  readonly effect: 'allow' | 'deny';
  /** The module that owns the rule file. */
  readonly module: string;
  readonly target: RuleTarget;
  readonly actions: ExpandedActions;
  /** `null`: every kind. */
  readonly principals: ReadonlySet<PrincipalKind> | null;
  /** `null`: the rule lists no fields. */
  readonly fields: ReadonlySet<string> | null;
  readonly reason: string | undefined;
  readonly entry: RuleEntry;
}
