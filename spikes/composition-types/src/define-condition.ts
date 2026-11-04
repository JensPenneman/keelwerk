import type { Dependency } from './any-module.ts';
import type { EntitiesIn, EntityPatches } from './define-contribution.ts';

/** The declaration half of a conditional part, listed by the base (section 5.4). */
export interface ConditionDecl<W extends readonly Dependency[], Es extends EntityPatches> {
  readonly kind: 'condition';
  readonly when: W;
  readonly entities: Es;
}

/** Any condition declaration. */
export type AnyConditionDecl = ConditionDecl<readonly Dependency[], EntityPatches>;

/** Declares what a module adds to itself when every module and contract in `when` is present. */
export function defineCondition<
  const W extends readonly Dependency[],
  const S extends { readonly entities?: EntityPatches },
>(when: W, spec: S): ConditionDecl<W, EntitiesIn<S>> {
  return { kind: 'condition', when, entities: (spec.entities ?? {}) as EntitiesIn<S> };
}
