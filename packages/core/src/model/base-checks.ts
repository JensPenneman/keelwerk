import type { AnyModuleBase } from './any-module-base.ts';
import type { Check } from './check.ts';
import type { ConditionsOf } from './conditions-of.ts';
import type { ContributionsOf } from './contributions-of.ts';
import type { EntitiesOf, EntityNames } from './entities-of.ts';
import type { ListOf } from './list-of.ts';
import type { ModuleIdsIn } from './module-ids-in.ts';

type RequiredIds<B> = ModuleIdsIn<ListOf<B, 'requires'>>;
type OptionalIds<B> = ModuleIdsIn<ListOf<B, 'optional'>>;

type RefsOf<Path extends string, F> = {
  [K in keyof F]: F[K] extends { readonly ref: { readonly module: infer Rm extends string } }
    ? `${Path}.${K & string} -> ${Rm}`
    : never;
}[keyof F];
type RefTarget<S> = S extends `${string} -> ${infer T}` ? T : never;
type BadRefs<Refs, Allowed> = Refs extends unknown
  ? RefTarget<Refs> extends Allowed
    ? never
    : Refs
  : never;
type EntityRefs<Path extends string, Es> = {
  [E in keyof Es]: Es[E] extends { readonly fields: infer F }
    ? RefsOf<`${Path}.${E & string}`, F>
    : never;
}[keyof Es];
type UnguardedOf<Path extends string, Es> = {
  [E in keyof Es]: Es[E] extends { readonly fields: infer F }
    ? {
        [K in keyof F]: F[K] extends
          | { readonly flags: { readonly optional: true } }
          | { readonly flags: { readonly defaulted: true } }
          ? never
          : `${Path}.${E & string}.${K & string}`;
      }[keyof F]
    : never;
}[keyof Es];

/** References may target a hard requirement, or inside a declaration its target and `when` modules. */
type RefsOutsideRequirements<B extends AnyModuleBase> =
  | BadRefs<EntityRefs<B['id'], EntitiesOf<B>>, RequiredIds<B>>
  | {
      [K in keyof ConditionsOf<B>]: ConditionsOf<B>[K] extends {
        readonly when: infer W;
        readonly entities: infer Es;
      }
        ? BadRefs<EntityRefs<`${B['id']}[${K & string}]`, Es>, RequiredIds<B> | ModuleIdsIn<W>>
        : never;
    }[keyof ConditionsOf<B>]
  | {
      [K in keyof ContributionsOf<B>]: ContributionsOf<B>[K] extends {
        readonly to: { readonly id: infer T extends string };
        readonly when: infer W;
        readonly entities: infer Es;
      }
        ? BadRefs<EntityRefs<`${B['id']}->${T}`, Es>, RequiredIds<B> | T | ModuleIdsIn<W>>
        : never;
    }[keyof ContributionsOf<B>];

/** Contributed and conditional fields must be optional or defaulted: rows are inserted while those parts are inactive. */
type UnguardedFields<B extends AnyModuleBase> =
  | {
      [K in keyof ConditionsOf<B>]: ConditionsOf<B>[K] extends { readonly entities: infer Es }
        ? UnguardedOf<`${B['id']}[${K & string}]`, Es>
        : never;
    }[keyof ConditionsOf<B>]
  | {
      [K in keyof ContributionsOf<B>]: ContributionsOf<B>[K] extends {
        readonly to: { readonly id: infer T extends string };
        readonly entities: infer Es;
      }
        ? UnguardedOf<`${B['id']}->${T}`, Es>
        : never;
    }[keyof ContributionsOf<B>];

/** A module may contribute only to modules it lists in `requires` or `optional` (section 5.3); the implicit `core` is always active and needs no entry (section 5.6). */
type ContributionsOutsideDependencies<B extends AnyModuleBase> = {
  [K in keyof ContributionsOf<B>]: ContributionsOf<B>[K] extends {
    readonly to: { readonly id: infer T extends string };
  }
    ? T extends 'core'
      ? never
      : T extends RequiredIds<B> | OptionalIds<B>
        ? never
        : `${B['id']}->${T}`
    : never;
}[keyof ContributionsOf<B>];

/** A conditional part may only patch the module's own entities. */
type UnknownConditionTargets<B extends AnyModuleBase> = {
  [K in keyof ConditionsOf<B>]: ConditionsOf<B>[K] extends { readonly entities: infer Es }
    ? Exclude<keyof Es & string, EntityNames<B>> extends infer Bad extends string
      ? [Bad] extends [never]
        ? never
        : `${B['id']}[${K & string}].${Bad}`
      : never
    : never;
}[keyof ConditionsOf<B>];

/** The named checks `defineModuleBase` applies (section 4.7, decision 98). */
export type BaseChecks<B extends AnyModuleBase> = Check<
  RefsOutsideRequirements<B>,
  'refsOutsideRequirements'
> &
  Check<UnguardedFields<B>, 'contributedFieldsNeedDefault'> &
  Check<ContributionsOutsideDependencies<B>, 'contributionsOutsideDependencies'> &
  Check<UnknownConditionTargets<B>, 'unknownConditionTargets'>;
