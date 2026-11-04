import type { DecideContext } from '../contexts/decide-context.ts';
import type { FillValue } from '../model/extension-value.ts';
import type { BaseOf, ContributionTargetOf, WhenOf } from '../model/part-source.ts';
import type { Empty } from '../types/empty.ts';
import type { AnyWithin } from './within.ts';

type PointsOf<M> = M extends { readonly extensionPoints: infer X } ? X : Empty;

/** A fill part: the values a contributor puts into a target's extension point. */
export interface FillPart<S, P extends string> {
  readonly kind: 'fill';
  readonly source: S;
  readonly point: P;
  readonly factory: object;
}

/** Fills an extension point of a contribution's target with a factory of the contributor's own context (gap G16). */
export function defineFill<
  const S extends AnyWithin,
  const P extends keyof PointsOf<ContributionTargetOf<S>> & string,
>(
  source: S,
  point: P,
  factory: (
    own: DecideContext<BaseOf<S>, WhenOf<S>>,
  ) => FillValue<PointsOf<ContributionTargetOf<S>>[P]>,
): FillPart<S, P> {
  return { kind: 'fill', source, point, factory };
}
