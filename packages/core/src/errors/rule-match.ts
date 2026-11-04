/** A policy rule that decided, or would have had to decide, a `forbidden` outcome. */
export interface RuleMatch {
  readonly id: string;
  readonly effect: 'allow' | 'deny';
}
