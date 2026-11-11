import type { NormalizedRule } from '../authorization/normalized-rule.ts';
import type { FlagSnapshot } from '../flags/flag-snapshot.ts';
import type { Principal } from '../principals/principal.ts';
import type { Registry } from '../registry/registry.ts';
import type { Scope } from '../storage/scope.ts';

/** What a state token is issued and checked against: the app, its rules, the principal and the scope's epoch. */
export interface StateTokenContext {
  readonly registry: Registry;
  readonly rules: readonly NormalizedRule[];
  readonly principal: Principal;
  /** The scope's epoch (section 15.2.6); a scope's positions restart only with a new one. */
  readonly epoch: number;
  /** The key that seals the tokens of the scope (`stateTokenKey`): without it no token is issued or accepted. */
  readonly sealKey: Uint8Array;
  /**
   * The key of another scope the invocation reads into (a tenant query that loads a backend
   * entity issues a token of the backend's scope, and that scope's own reads check it under the
   * backend's key). Absent: every token is sealed with `sealKey`.
   */
  readonly sealKeyOf?: ((scope: Scope) => Uint8Array) | undefined;
  /** The invocation's flag snapshot: the flags the read rules read are part of the token's check (20.6). */
  readonly flags?: FlagSnapshot | undefined;
}
