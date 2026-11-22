import type { AdapterCapabilities } from '@keelwerk/core';
import type { FactValues, PlacementFacts } from './deployment-facts.ts';
import type { DoctorFinding } from './doctor-finding.ts';

declare const checkBrand: unique symbol;

/** A union has more than one member; a lone type does not. */
type IsUnion<T, U = T> = T extends U ? ([U] extends [T] ? false : true) : never;

/** What the runner reads of a check: its functions take values it chooses, so it casts them. */
type CheckShape = ShapeOf<never, Needs>;

export type Needs = readonly (keyof FactValues)[];

/** The plain values of the facts a check named, and only those. */
export type ValuesOf<N extends Needs> = { readonly [K in N[number]]: FactValues[K] };

/** A placement whose adapter doctor could open. */
export interface OpenPlacement {
  readonly name: string;
  readonly adapter: string;
  readonly apps: readonly string[];
  readonly capabilities: AdapterCapabilities;
}

/**
 * A check as the runner sees it: the facts it needs and how it judges them. Only `defineCheck`,
 * `unfedCheck` and `definePlacementCheck` make one, and `checkOf`, which they call, takes only a
 * shape whose judge, `applies` and `concerns` receive no more than the facts in its `needs`
 * tuple. Doctor's own code never writes a plain object of this type.
 *
 * What the type guards, and where it stops. It holds for a `needs` whose type is one tuple of
 * single names. `NeedsLiteral` refuses the other forms TypeScript infers from a `needs` written
 * in place or accepts as an explicit type argument: the wide `Needs`, a tuple with a union
 * element, and a union of tuples; the type test names each of them. A type assertion is outside
 * what a type can guard. At run time the runner hands a judge only the facts its `needs` lists,
 * so a judge that reads another fact gets `undefined`, never a value. A further spelling is
 * closed only if TypeScript infers it from a `needs` written in place.
 */
export type DeploymentCheck = CheckShape & { readonly [checkBrand]: true };

/**
 * `Needs` as one tuple of single names: a `needs` typed as the wide `Needs`, as a tuple with a
 * union element, or as a union of tuples would let a judge read facts the runner does not hand it.
 */
export type NeedsLiteral<N extends Needs> = number extends N['length']
  ? never
  : IsUnion<N> extends true
    ? never
    : true extends { readonly [I in keyof N]: IsUnion<N[I]> }[number]
      ? never
      : N;

/** A check with the facts of `N` named: every function of it receives the values of those facts. `Listed` is the type of its `needs`. */
export type ShapeOf<N extends Needs, Listed extends Needs = NeedsLiteral<N>> =
  | {
      readonly kind: 'judged';
      readonly group: string;
      readonly name: string;
      readonly needs: Listed;
      readonly applies: ((values: ValuesOf<N>) => boolean) | undefined;
      readonly judge: (values: ValuesOf<N>) => readonly DoctorFinding[];
    }
  | {
      readonly kind: 'unfed';
      readonly group: string;
      readonly name: string;
      readonly needs: Listed;
      readonly applies: ((values: ValuesOf<N>) => boolean) | undefined;
      /** Why no source feeds the check. */
      readonly reason: string;
    }
  | {
      readonly kind: 'placement';
      readonly group: string;
      readonly name: string;
      readonly needs: Listed;
      readonly concerns: ((values: ValuesOf<N>, placement: PlacementFacts) => boolean) | undefined;
      readonly judge: (values: ValuesOf<N>, placement: OpenPlacement) => readonly DoctorFinding[];
    };

/** Brands a shape: the one place a check is made, used by the constructors only. */
export function checkOf<const N extends Needs>(shape: ShapeOf<N>): DeploymentCheck {
  return shape as unknown as DeploymentCheck;
}
