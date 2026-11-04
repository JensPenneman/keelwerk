import type { ConditionDecl } from '../dsl/define-condition.ts';
import type { ContributionDecl, EntityPatches } from '../dsl/define-contribution.ts';
import type { AnyWithin, DeclarationSection, Within } from '../dsl/within.ts';
import type { AnyModule, Dependency } from './any-module.ts';
import type { AnyModuleBase } from './any-module-base.ts';
import type { ConditionsOf } from './conditions-of.ts';
import type { ContributionsOf } from './contributions-of.ts';

/** The base app actions are typed against: the selection counts as required (section 4.3). */
export interface AppSource<Ms extends readonly AnyModule[]> {
  readonly id: 'app';
  readonly version: '0.0.0';
  readonly requires: Ms;
}

/** What a part is typed against: a module base, a `within` narrowing, or an app's selection. */
export type PartSource = AnyModuleBase | AnyWithin | readonly AnyModule[];

/** The base behind a part source. */
export type BaseOf<S> =
  S extends Within<infer B, string, DeclarationSection>
    ? B
    : S extends readonly AnyModule[]
      ? AppSource<S>
      : S extends AnyModuleBase
        ? S
        : never;

/** The declaration a `within` narrowing names. */
export type DeclarationOf<S> =
  S extends Within<infer B, infer K, infer Sec>
    ? Sec extends 'contributions'
      ? K extends keyof ContributionsOf<B>
        ? ContributionsOf<B>[K]
        : never
      : K extends keyof ConditionsOf<B>
        ? ConditionsOf<B>[K]
        : never
    : never;

/** The modules and contracts that count as required inside a part: the target and `when` list. */
export type WhenOf<S> =
  DeclarationOf<S> extends infer D
    ? [D] extends [never]
      ? readonly []
      : D extends ContributionDecl<infer To, infer W extends readonly Dependency[], EntityPatches>
        ? readonly [To, ...W]
        : D extends ConditionDecl<infer W extends readonly Dependency[], EntityPatches>
          ? W
          : readonly []
    : never;

/** The target module of a contribution part. */
export type ContributionTargetOf<S> =
  DeclarationOf<S> extends ContributionDecl<infer To, readonly Dependency[], EntityPatches>
    ? To
    : never;

/** The module id own references resolve against. */
export type OwnerOf<S> = BaseOf<S>['id'];
