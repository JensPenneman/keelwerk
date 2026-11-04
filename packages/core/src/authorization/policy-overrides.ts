import type { RuleEntry } from '../registry/rule-entry.ts';

/** The rule overrides of an app (section 8.7). */
export interface PolicyOverrides {
  /** Rule ids to switch off; an id that names no rule of the selection is a compose error. */
  readonly disable?: readonly string[];
  /** Extra rules written in the app. */
  readonly add?: readonly RuleEntry[];
  /** A module's rule set, replaced wholesale by these rules. */
  readonly replace?: { readonly [module: string]: readonly RuleEntry[] };
}
