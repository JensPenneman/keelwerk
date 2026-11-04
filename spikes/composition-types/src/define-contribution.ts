import type { AnyModule, Dependency } from './any-module.ts';
import type { EntityNames } from './base-members.ts';
import type { Check } from './check.ts';
import type { Relations } from './define-entity.ts';
import type { ShapeFields } from './shape.ts';

/** What a declaration adds to one entity: fields (optional or defaulted) and relations. */
export interface EntityPatch {
  readonly fields?: ShapeFields;
  readonly relations?: Relations;
}

/** Entity patches, by entity name. */
export type EntityPatches = { readonly [entity: string]: EntityPatch };

/** The declaration half of a contribution, listed by the base (section 5.3). */
export interface ContributionDecl<
  To extends AnyModule,
  W extends readonly Dependency[],
  Es extends EntityPatches,
> {
  readonly kind: 'contribution';
  readonly to: To;
  readonly when: W;
  readonly entities: Es;
}

/** Any contribution declaration. */
export type AnyContributionDecl = ContributionDecl<AnyModule, readonly Dependency[], EntityPatches>;

/** The literal `defineContribution` takes. */
export interface ContributionSpec {
  readonly when?: readonly Dependency[];
  readonly entities?: EntityPatches;
}

/** The `when` list of a spec, empty when absent. */
export type WhenIn<S> = S extends { readonly when: infer W extends readonly Dependency[] }
  ? W
  : readonly [];

/** The entity patches of a spec, empty when absent. */
export type EntitiesIn<S> = S extends { readonly entities: infer Es extends EntityPatches }
  ? Es
  : {};

/**
 * Declares what a module adds to another module's entities. A target entity the target does not
 * define is a compile error here, because the contributor imported the target (section 5.3). The
 * whole literal is one type parameter: a defaulted parameter for `when` picks up the contextual
 * type `readonly Dependency[]` when the call is nested in `defineModuleBase({ ... })`.
 */
export function defineContribution<const To extends AnyModule, const S extends ContributionSpec>(
  to: To,
  spec: S &
    Check<Exclude<keyof EntitiesIn<S> & string, EntityNames<To>>, 'unknownContributionTargets'>,
): ContributionDecl<To, WhenIn<S>, EntitiesIn<S>> {
  return {
    kind: 'contribution',
    to,
    when: (spec.when ?? []) as WhenIn<S>,
    entities: (spec.entities ?? {}) as EntitiesIn<S>,
  };
}
