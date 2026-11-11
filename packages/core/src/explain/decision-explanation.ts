/** A rule the decision names, with the module and file a reader changes to change the outcome. */
export interface ExplainedRule {
  readonly id: string;
  readonly effect: 'allow' | 'deny';
  readonly module: string;
  readonly file: string;
  readonly reason?: string;
}

/** Which rules reveal or hide one maskable field (section 16.4.5). */
export interface ExplainedMask {
  readonly field: string;
  readonly revealedBy: readonly string[];
  readonly hiddenBy: readonly string[];
}

/** The plan of an entity action, rendered. */
export interface ExplainedPlan {
  readonly kind: 'always' | 'never' | 'conditional';
  readonly operation: string;
  readonly entity: string;
  /** The rendered selection. */
  readonly selects: string;
  /** `ability.explain(plan)`: the selection and each allow and deny clause. */
  readonly text: string;
  readonly masks: readonly ExplainedMask[];
}

/** The authorization decision of one action for one principal, without executing it (section 8.6). */
export interface DecisionExplanation {
  readonly action: string;
  readonly kind: string;
  /** `roles`: the roles the decision used, after the enrichers and `--roles`. */
  readonly principal: {
    readonly kind: string;
    readonly id?: string;
    readonly roles: readonly string[];
  };
  readonly scope: string;
  readonly allowed: boolean;
  /** The deciding deny rule's reason, or the gate check that refused. */
  readonly reason?: string;
  /** Allowed: the allow rules in effect. Denied: the deny rules, or the allows that would have had to hold. */
  readonly rules: readonly ExplainedRule[];
  readonly plan?: ExplainedPlan;
  /** What else shapes the answer without changing the verdict, e.g. a row output replaced by its reference. */
  readonly notes?: readonly string[];
}
