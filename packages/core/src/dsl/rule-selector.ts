import type { ActionKind } from '../model/action-part.ts';

/**
 * A rule subject across modules (section 8.1, G13): the action kinds and/or the transports the rule
 * covers. At least one of the two is named, and a rule over a selector is a deny rule: an allow over
 * every module's actions is not offered to a module.
 */
export type RuleSelector =
  | { readonly kinds: readonly ActionKind[]; readonly transports?: readonly string[] }
  | { readonly kinds?: readonly ActionKind[]; readonly transports: readonly string[] };
