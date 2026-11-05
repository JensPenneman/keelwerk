import type { NormalizedRule } from '../authorization/normalized-rule.ts';
import type { Principal } from '../principals/principal.ts';
import type { Registry } from '../registry/registry.ts';

/** What a state token is issued and checked against: the app, its rules, the principal and the scope's epoch. */
export interface StateTokenContext {
  readonly registry: Registry;
  readonly rules: readonly NormalizedRule[];
  readonly principal: Principal;
  /** The scope's epoch (section 15.2.6); a scope's positions restart only with a new one. */
  readonly epoch: number;
}
