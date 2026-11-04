/** A rule part's visible members. */
export interface RuleView {
  readonly kind: 'rule';
  readonly target: unknown;
  readonly actions: readonly string[];
  readonly spec: object;
}

/** Whether a value is a rule part. */
export function isRule(value: object): value is RuleView {
  return Reflect.get(value, 'kind') === 'rule';
}
