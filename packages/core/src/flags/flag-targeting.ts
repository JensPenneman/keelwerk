import type { ConditionInput } from '../conditions/condition-input.ts';

/** A served value as the operator typed it: JSON only, never code (20.4). */
export type FlagValue =
  | boolean
  | string
  | number
  | readonly unknown[]
  | { readonly [key: string]: unknown };

/** One served value; `variant` is required for an object or array value, else it defaults to String(value). */
export interface FlagVariant {
  readonly value: FlagValue;
  readonly variant?: string;
}

/** A share of a split: weight in basis points, an integer 0..10,000. */
export interface FlagShare extends FlagVariant {
  readonly weight: number;
}

/** Shares own cumulative ranges in the listed order; weights sum to 10,000; salt default the flag key. */
export interface FlagSplit {
  readonly split: readonly FlagShare[];
  readonly salt?: string;
}

/** What a rule or the fallthrough serves. */
export type FlagServe = FlagVariant | FlagSplit;

/** One ordered rule; every criterion it names must match, and it names at least one. */
export interface FlagRule {
  /** Matches /^[a-z0-9][a-z0-9_-]{0,63}$/ and is unique in the rule set. */
  readonly id: string;
  /** Tenant ids (uuid), at most 1,000. */
  readonly tenants?: readonly string[];
  /** Principal ids as `principalIdOf` names them, 1..200 characters, at most 1,000. */
  readonly principals?: readonly string[];
  /** The 8.3 object form over `targetingAttributeNames` only. */
  readonly when?: ConditionInput;
  readonly serve: FlagServe;
}

/** A flag's targeting for one backend or for the deployment (20.4). */
export interface FlagTargeting {
  readonly enabled: boolean;
  readonly rules: readonly FlagRule[];
  readonly fallthrough: FlagServe;
}
