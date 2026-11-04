/** A named problem `compose` found (sections 3.3 and 5.5): `defineApp` refuses an app with any error. */
export interface CompositionProblem {
  /** The problem's name in lower camel case: 'unknownRuleActions', 'emptyExtensionPoints', 'asyncReactionsUnavailable'. */
  readonly code: string;
  readonly severity: 'error' | 'warning';
  readonly message: string;
  /** The module the problem concerns. */
  readonly module?: string;
  /** The entity, action, rule or point reference the problem concerns. */
  readonly ref?: string;
}
