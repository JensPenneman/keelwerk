import type { PrincipalContext } from '../contexts/principal-context.ts';
import type { OwnRef } from '../fields/field-def.ts';
import type { AnyActionPart } from '../model/action-part.ts';
import type { AnyModule } from '../model/any-module.ts';
import type { AnyModuleBase } from '../model/any-module-base.ts';
import type { Check } from '../model/check.ts';
import type { ContributedFields, ContributedMember } from '../model/contributed-member.ts';
import type { DependencyRow } from '../model/dependency-row.ts';
import type { EntityAt } from '../model/entities-of.ts';
import type { EntityTargetOf } from '../model/entity-target-of.ts';
import type { FieldsOf } from '../model/fields-of.ts';
import type { OwnFields, OwnRow } from '../model/own-row.ts';
import type { BaseOf, ContributionTargetOf, PartSource, WhenOf } from '../model/part-source.ts';
import type { RelationsOf } from '../model/relations-of.ts';
import type { TargetName } from '../model/target-name.ts';
import type { Where } from '../model/where.ts';
import type { PrincipalKind } from '../principals/principal-kind.ts';
import { isRuleSelector } from './is-rule-selector.ts';
import { mountName } from './mount-name.ts';
import type { RuleSelector } from './rule-selector.ts';

type ReadAction = 'read' | 'get' | 'query' | 'changes' | 'queryChanges' | 'watch' | 'history';
type IsReadRule<A extends readonly string[]> = [Extract<A[number], ReadAction>] extends [never]
  ? false
  : true;

type NonHidden<F> = {
  [K in keyof F as F[K] extends { readonly flags: { readonly hidden: true } } ? never : K]: F[K];
};

type RuleFields<S, T> = T extends string
  ? ContributionTargetOf<S> extends infer D extends AnyModule
    ? NonHidden<FieldsOf<EntityAt<D, T>>> & ContributedFields<BaseOf<S>, WhenOf<S>, D['id'], T>
    : never
  : NonHidden<OwnFields<BaseOf<S>, TargetName<S, T>>>;

type RuleRow<S, T> = T extends string
  ? ContributionTargetOf<S> extends infer D extends AnyModule
    ? DependencyRow<BaseOf<S>, WhenOf<S>, D, T>
    : never
  : OwnRow<BaseOf<S>, TargetName<S, T>, 'dependency'>;

type RuleRelations<S, T> = T extends string
  ? ContributionTargetOf<S> extends infer D extends AnyModule
    ? RelationsOf<EntityAt<D, T>> & ContributedMember<BaseOf<S>, WhenOf<S>, D['id'], T, 'relations'>
    : never
  : RelationsOf<EntityAt<BaseOf<S>, TargetName<S, T>>>;

type RelatedRow<B extends AnyModuleBase, Rel> = Rel extends { readonly target: OwnRef<infer E> }
  ? OwnRow<B, E, 'dependency'>
  : { readonly [field: string]: unknown };

type RelationRows<B extends AnyModuleBase, Rels> = {
  readonly [K in keyof Rels]: Rels[K] extends { readonly cardinality: 'many' }
    ? readonly RelatedRow<B, Rels[K]>[]
    : RelatedRow<B, Rels[K]>;
};

type QuantifierOp = 'some' | 'none' | 'every' | 'is';

/** The unknown keys inside the quantifiers of one relation: its related entity's fields and relations apply there. */
type UnknownInRelation<
  Q,
  Rel,
  B extends AnyModuleBase,
  Depth extends readonly unknown[],
> = Rel extends { readonly target: OwnRef<infer E> }
  ? Q extends object
    ? {
        [O in keyof Q]-?: O extends QuantifierOp
          ? UnknownKeys<
              Q[O],
              keyof OwnRow<B, E, 'dependency'> | keyof RelationsOf<EntityAt<B, E>>,
              RelationsOf<EntityAt<B, E>>,
              B,
              [...Depth, unknown]
            >
          : never;
      }[keyof Q]
    : never
  : never;

type UnknownKeys<
  C,
  Allowed,
  Rels,
  B extends AnyModuleBase,
  Depth extends readonly unknown[] = [],
> = Depth['length'] extends 8
  ? never
  : C extends object
    ? {
        [K in keyof C]-?: K extends 'or' | 'and'
          ? C[K] extends readonly (infer I)[]
            ? UnknownKeys<I, Allowed, Rels, B, [...Depth, unknown]>
            : never
          : K extends 'not'
            ? UnknownKeys<C[K], Allowed, Rels, B, [...Depth, unknown]>
            : K extends Allowed
              ? K extends keyof Rels
                ? UnknownInRelation<C[K], Rels[K], B, Depth>
                : never
              : K & string;
      }[keyof C]
    : never;
type ConditionKeys<S, T> = keyof RuleRow<S, T> | keyof RuleRelations<S, T>;

type MaskableKeys<F> = {
  [K in keyof F]: F[K] extends { readonly flags: { readonly maskable: true } } ? K : never;
}[keyof F] &
  string;

/** A typed condition of an entity rule: fields of the row acted on and its relations (section 8.3). */
export type RuleCondition<S, T> = Where<
  RuleRow<S, T>,
  RuleFields<S, T>,
  RelationRows<BaseOf<S>, RuleRelations<S, T>>
>;

/** The field names a rule may list: maskable fields for read rules, any field for write rules (section 8.1). */
export type RuleFieldName<S, T, A extends readonly string[]> =
  IsReadRule<A> extends true ? MaskableKeys<RuleFields<S, T>> : keyof RuleFields<S, T> & string;

/** A rule over an entity. */
export interface EntityRuleSpec<
  S,
  T,
  A extends readonly string[],
  Pk extends PrincipalKind,
  Cw,
  Ck,
> {
  readonly effect: 'allow' | 'deny';
  readonly actions?: A;
  readonly principal?: Pk | readonly Pk[];
  readonly public?: boolean;
  readonly where?: (ctx: PrincipalContext<Pk>) => Cw;
  readonly check?: (ctx: PrincipalContext<Pk>) => Ck;
  readonly fields?: readonly RuleFieldName<S, T, A>[];
  readonly reason?: string;
}

/** A rule over a module-level action. */
export interface ActionRuleSpec<Pk extends PrincipalKind> {
  readonly effect: 'allow' | 'deny';
  readonly public?: boolean;
  readonly principal?: Pk | readonly Pk[];
  readonly when?: (ctx: PrincipalContext<Pk>, input: unknown) => boolean;
  readonly reason?: string;
}

/** What a rule may target: an own entity, a contribution target's entity by name, an own action, or a selector across modules. */
export type RuleTargetOf<S> = EntityTargetOf<S> | AnyActionPart | RuleSelector;

/**
 * The literal of a rule, by target. A rule over a selector (action kinds and/or transports across
 * modules) is a deny rule only: one module never grants access to the actions of every other module.
 */
export type RuleSpec<
  S,
  T,
  A extends readonly string[],
  Pk extends PrincipalKind,
  Cw,
  Ck,
> = T extends AnyActionPart
  ? ActionRuleSpec<Pk>
  : T extends RuleSelector
    ? Omit<ActionRuleSpec<Pk>, 'effect'> & { readonly effect: 'deny' }
    : EntityRuleSpec<S, T, A, Pk, Cw, Ck> &
        Check<
          UnknownKeys<Cw | Ck, ConditionKeys<S, T>, RuleRelations<S, T>, BaseOf<S>>,
          'unknownConditionFields'
        >;

/**
 * A rule part: its base, its target and the action names it lists; the id comes from where the
 * module literal mounts it. `defineModule` checks the names and the policy key (decision 105).
 */
export interface RulePart<S, T, A extends readonly string[] = readonly string[]> {
  readonly kind: 'rule';
  readonly source: S;
  readonly target: T;
  readonly actions: A;
  readonly spec: object;
}

/** Defines one rule (section 4.4). */
export function defineRule<
  const S extends PartSource,
  const T extends RuleTargetOf<S>,
  const A extends readonly string[] = readonly [],
  const Pk extends PrincipalKind = PrincipalKind,
  const Cw extends RuleCondition<S, T> | boolean = boolean,
  const Ck extends RuleCondition<S, T> | boolean = boolean,
>(
  source: S,
  target: T,
  spec: RuleSpec<S, T, A, Pk, Cw, Ck>,
): RulePart<S, T extends AnyActionPart | RuleSelector ? T : TargetName<S, T>, A> {
  const named =
    isRuleSelector(target) || (typeof target === 'object' && target !== null && 'spec' in target)
      ? target
      : mountName(source, target);
  const actions = (spec as { readonly actions?: readonly string[] }).actions ?? [];
  return { kind: 'rule', source, target: named, actions, spec } as RulePart<
    S,
    T extends AnyActionPart | RuleSelector ? T : TargetName<S, T>,
    A
  >;
}
