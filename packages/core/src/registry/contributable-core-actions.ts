/**
 * The module-level actions of the core that a module may add a rule to through its contribution to
 * the core (section 8.7): `core.eraseSubject`, whose rule is the platform's to widen. A rule on any
 * other core action stays `unknownPolicyTargets`.
 */
export const contributableCoreActions: ReadonlySet<string> = new Set(['eraseSubject']);
