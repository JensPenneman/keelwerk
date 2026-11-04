import type { Shape } from '../fields/shape.ts';

/** What a flag is for (section 20.2). */
export type FlagPurpose = 'release' | 'experiment' | 'operational' | 'kill-switch' | 'permission';

/** Whose key splits a flag's rollout (section 20.2). */
export type FlagLevel = 'deployment' | 'backend' | 'tenant' | 'principal';

/** Fields every flag declaration shares. */
export interface FlagBase {
  readonly level: FlagLevel;
  readonly purpose: FlagPurpose;
  /** Required for release and experiment flags: an ISO date. */
  readonly expires?: string;
  /** Readable by clients through `core.flag.evaluate`. */
  readonly client?: boolean;
  readonly tenantEditable?: boolean;
}

/** A boolean flag. */
export interface BooleanFlag extends FlagBase {
  readonly kind: 'boolean';
  readonly default: boolean;
}

/** A flag with a string value. */
export interface StringFlag extends FlagBase {
  readonly kind: 'string';
  readonly default: string;
}

/** A flag with a number value, optionally bounded. */
export interface NumberFlag extends FlagBase {
  readonly kind: 'number';
  readonly default: number;
  readonly min?: number;
  readonly max?: number;
}

/** A flag whose value is JSON checked by a shape. */
export interface JsonFlag extends FlagBase {
  readonly kind: 'json';
  readonly schema: Shape;
  readonly default: unknown;
}

/** A flag with a closed set of variants. */
export interface VariantFlag<V extends string = string> extends FlagBase {
  readonly kind: 'variant';
  readonly variants: readonly V[];
  readonly default: V;
}

/** Any flag declaration. */
export type FlagDeclaration = BooleanFlag | StringFlag | NumberFlag | JsonFlag | VariantFlag;

/**
 * Declares a flag, listed by the base of its owning module under `flags` (section 20.2). A typed
 * declaration in M1: a flag request answers the declared default with reason `default` (S-23).
 */
export function defineFlag<const F extends FlagDeclaration>(flag: F): F {
  return flag;
}
