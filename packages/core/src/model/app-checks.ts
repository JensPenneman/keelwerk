import type { AllKeys } from './all-keys.ts';
import type { AnyModule } from './any-module.ts';
import type { CommandRefsOf } from './app-action-tree.ts';
import type { EntityFields, FieldSources } from './app-entities.ts';
import type { Check } from './check.ts';
import type { ContractsIn } from './contracts-in.ts';
import type { EntityNames } from './entities-of.ts';
import type { IsUnion } from './is-union.ts';
import type { ModuleIdsIn } from './module-ids-in.ts';
import type { AllContributions, ById, Ids, ProvidedContracts, WithCore } from './selection.ts';

type RequiredModuleIds<Ms extends readonly AnyModule[]> = Ms[number] extends infer M
  ? M extends { readonly requires: infer L }
    ? ModuleIdsIn<L>
    : never
  : never;
type RequiredAppContracts<Ms extends readonly AnyModule[]> = Ms[number] extends infer M
  ? M extends { readonly requires: infer L }
    ? ContractsIn<L, 'app'>
    : never
  : never;
type MissingRequirements<Ms extends readonly AnyModule[]> =
  | Exclude<RequiredModuleIds<Ms>, Ids<Ms>>
  | Exclude<RequiredAppContracts<Ms>, ProvidedContracts<Ms>>;

/** Positions are compared on the author's tuple: a variadic `[Core, ...Ms]` numbers spread elements from zero again. */
type DuplicateIds<Ms extends readonly AnyModule[]> = {
  [P in keyof Ms]: Ms[P] extends { readonly id: infer A extends string }
    ? {
        [Q in keyof Ms]: Q extends P ? never : Ms[Q] extends { readonly id: A } ? A : never;
      }[number]
    : never;
}[number];

/** A field defined by more than one source, whatever the types: mirrors the boot check. */
type SourcesDefining<S, K extends PropertyKey> = S extends {
  readonly source: infer Tag;
  readonly fields: infer F;
}
  ? K extends keyof F
    ? Tag
    : never
  : never;
type ConflictingFields<Ms extends readonly AnyModule[]> = {
  [I in Ids<Ms>]: {
    [E in EntityNames<ById<Ms, I>>]: {
      [K in AllKeys<FieldSources<Ms, I, E>['fields']> & string]: IsUnion<
        SourcesDefining<FieldSources<Ms, I, E>, K>
      > extends true
        ? `${I}.${E}.${K}`
        : never;
    }[AllKeys<FieldSources<Ms, I, E>['fields']> & string];
  }[EntityNames<ById<Ms, I>>];
}[Ids<Ms>];

/** Contributions naming an entity the selected target does not define (a typo, not a toggling effect). */
type UnknownContributionTargets<Ms extends readonly AnyModule[]> =
  AllContributions<Ms> extends infer C
    ? C extends {
        readonly from: infer From extends string;
        readonly to: { readonly id: infer To extends string };
        readonly entities: infer Es;
      }
      ? To extends Ids<Ms>
        ? Exclude<keyof Es & string, EntityNames<ById<Ms, To>>> extends infer Bad extends string
          ? [Bad] extends [never]
            ? never
            : `${From} -> ${To}.${Bad}`
          : never
        : never
      : never
    : never;

/** References whose target module or entity is not selected, over active fields only. */
type DanglingRefs<Ms extends readonly AnyModule[]> = {
  [I in Ids<Ms>]: {
    [E in EntityNames<ById<Ms, I>>]: {
      [K in keyof EntityFields<Ms, I, E>]: EntityFields<Ms, I, E>[K] extends {
        readonly ref: {
          readonly module: infer Rm extends string;
          readonly entity: infer Re extends string;
        };
      }
        ? Rm extends Ids<Ms>
          ? Re extends EntityNames<ById<Ms, Rm>>
            ? never
            : `${I}.${E}.${K & string} -> ${Rm}.${Re}`
          : `${I}.${E}.${K & string} -> ${Rm}.${Re}`
        : never;
    }[keyof EntityFields<Ms, I, E>];
  }[EntityNames<ById<Ms, I>>];
}[Ids<Ms>];

/** The checks of `defineApp`, over the author's tuple `Ms`; lookups add the core module. */
export type AppChecks<Ms extends readonly AnyModule[], A, X> = Check<
  MissingRequirements<WithCore<Ms>>,
  'missingModules'
> &
  Check<DuplicateIds<Ms>, 'duplicateModuleIds'> &
  Check<Extract<Ids<Ms>, 'core' | 'app'>, 'reservedModuleIds'> &
  Check<ConflictingFields<WithCore<Ms>>, 'conflictingFields'> &
  Check<UnknownContributionTargets<WithCore<Ms>>, 'unknownContributionTargets'> &
  Check<DanglingRefs<WithCore<Ms>>, 'danglingReferences'> &
  Check<Exclude<keyof X & string, CommandRefsOf<WithCore<Ms>, A>>, 'unknownExecutionOverrides'>;
