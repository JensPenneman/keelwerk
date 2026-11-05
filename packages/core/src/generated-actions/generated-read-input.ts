import type { NormalizedRule } from '../authorization/normalized-rule.ts';
import type { Principal } from '../principals/principal.ts';
import type { ActionEntry } from '../registry/action-entry.ts';
import type { EntityEntry } from '../registry/entity-entry.ts';
import type { Registry } from '../registry/registry.ts';
import type { Position } from '../storage/position.ts';
import type { Scope } from '../storage/scope.ts';
import type { Unit } from '../storage/unit.ts';
import type { StateTokenContext } from '../tokens/state-token-context.ts';

/** What a generated read runs with: the read-only unit, whose head was its first statement. */
export interface GeneratedReadInput {
  readonly unit: Unit;
  readonly registry: Registry;
  readonly entry: EntityEntry;
  readonly action: ActionEntry;
  readonly principal: Principal;
  readonly rules: readonly NormalizedRule[];
  readonly tokens: StateTokenContext;
  /** The unit's scope. */
  readonly scope: Scope;
  /** The validated input as the wire carried it. */
  readonly input: unknown;
  /** The highest committed position of the scope, read before anything else; 0 for a scope that never appended. */
  readonly head: Position;
}

/** The implementation of one generated read. */
export type GeneratedRead = (input: GeneratedReadInput) => Promise<unknown>;
