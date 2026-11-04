import type { Dependency } from './any-module.ts';
import type {
  ConditionsOf,
  ContributionsOf,
  EntitiesOf,
  ListOf,
  ModuleIdsIn,
} from './base-members.ts';
import type { Check } from './check.ts';
import type { AnyConditionDecl } from './define-condition.ts';
import type { AnyContract } from './define-contract.ts';
import type { AnyContributionDecl } from './define-contribution.ts';
import type { AnyEntity, GeneratorTemplate } from './define-entity.ts';
import type { ExtensionPoint } from './extension-point.ts';
import type { Shape } from './shape.ts';

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

/** A module may contribute only to modules it lists in `requires` or `optional` (section 5.3). */
type ContributionsOutsideDependencies<B extends AnyModuleBase> = {
  [K in keyof ContributionsOf<B>]: ContributionsOf<B>[K] extends {
    readonly to: { readonly id: infer T extends string };
  }
    ? T extends RequiredIds<B> | OptionalIds<B>
      ? never
      : `${B['id']}->${T}`
    : never;
}[keyof ContributionsOf<B>];

/** A conditional part may only patch the module's own entities. */
type UnknownConditionTargets<B extends AnyModuleBase> = {
  [K in keyof ConditionsOf<B>]: ConditionsOf<B>[K] extends { readonly entities: infer Es }
    ? Exclude<keyof Es & string, keyof EntitiesOf<B> & string> extends infer Bad extends string
      ? [Bad] extends [never]
        ? never
        : `${B['id']}[${K & string}].${Bad}`
      : never
    : never;
}[keyof ConditionsOf<B>];

type BaseChecks<B extends AnyModuleBase> = Check<
  RefsOutsideRequirements<B>,
  'refsOutsideRequirements'
> &
  Check<UnguardedFields<B>, 'contributedFieldsNeedDefault'> &
  Check<ContributionsOutsideDependencies<B>, 'contributionsOutsideDependencies'> &
  Check<UnknownConditionTargets<B>, 'unknownConditionTargets'>;

/** The module base: everything a handler's types depend on (section 4.1). */
export interface AnyModuleBase {
  readonly id: string;
  readonly version: string;
  readonly requires?: readonly Dependency[];
  readonly optional?: readonly Dependency[];
  readonly provides?: readonly AnyContract[];
  readonly generates?: readonly GeneratorTemplate[];
  readonly config?: Shape;
  readonly data?: {
    readonly needs?: readonly unknown[];
    readonly sql?: 'postgres' | 'mysql' | 'sqlite';
  };
  readonly extensionPoints?: { readonly [name: string]: ExtensionPoint<unknown> };
  readonly entities?: { readonly [name: string]: AnyEntity };
  readonly streams?: { readonly [name: string]: object };
  readonly flags?: { readonly [name: string]: object };
  readonly contributions?: { readonly [key: string]: AnyContributionDecl };
  readonly conditions?: { readonly [key: string]: AnyConditionDecl };
}

/** The named type of a module base: the identity; extending it in an interface gives emit a name. */
export type ModuleBaseType<T extends AnyModuleBase> = T;

/**
 * The module base. The data-level module checks of section 4.7 (`refsOutsideRequirements`,
 * `contributedFieldsNeedDefault`) run here, because the data lives in the base.
 */
export function defineModuleBase<const B extends AnyModuleBase>(base: B & BaseChecks<B>): B {
  return base;
}
