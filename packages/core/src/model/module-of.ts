import type { ConditionDecl } from '../dsl/define-condition.ts';
import type { ContributionDecl } from '../dsl/define-contribution.ts';
import type { Empty } from '../types/empty.ts';
import type { AnyModuleBase } from './any-module-base.ts';
import type { ConditionsOf } from './conditions-of.ts';
import type { ContributionsOf } from './contributions-of.ts';
import type { EntitiesOf } from './entities-of.ts';
import type { FieldsOf } from './fields-of.ts';
import type { ListOf } from './list-of.ts';
import type { MemberOf } from './member-of.ts';
import type { RelationsOf } from './relations-of.ts';

type EntityActionsIn<L, E> =
  MemberOf<L, 'entityActions'> extends infer Ea ? (E extends keyof Ea ? Ea[E] : Empty) : Empty;
type BehaviourOf<L, Sec extends string, K> =
  MemberOf<L, Sec> extends infer Bh ? (K extends keyof Bh ? Bh[K] : Empty) : Empty;

type NormalisedEntities<B, L> = {
  readonly [E in keyof EntitiesOf<B>]: EntitiesOf<B>[E] & {
    readonly actions: EntityActionsIn<L, E>;
  };
};
type PatchedEntities<Es, Bh> = {
  readonly [E in keyof Es | keyof MemberOf<Bh, 'entityActions'>]: {
    readonly fields: E extends keyof Es ? FieldsOf<Es[E]> : Empty;
    readonly relations: E extends keyof Es ? RelationsOf<Es[E]> : Empty;
    readonly actions: EntityActionsIn<Bh, E>;
  };
};
type BehaviourSections<Bh> = {
  readonly policies: MemberOf<Bh, 'policies'>;
  readonly reactions: MemberOf<Bh, 'reactions'>;
  readonly fills: MemberOf<Bh, 'extensionPoints'>;
};
type NormalisedContribution<B, L> = {
  [K in keyof ContributionsOf<B>]: ContributionsOf<B>[K] extends ContributionDecl<
    infer To,
    infer W,
    infer Es
  >
    ? {
        readonly key: K;
        readonly to: To;
        readonly when: W;
        readonly entities: PatchedEntities<Es, BehaviourOf<L, 'contributes', K>>;
        readonly actions: MemberOf<BehaviourOf<L, 'contributes', K>, 'actions'>;
      } & BehaviourSections<BehaviourOf<L, 'contributes', K>>
    : never;
}[keyof ContributionsOf<B>];
type NormalisedConditional<B, L> = {
  [K in keyof ConditionsOf<B>]: ConditionsOf<B>[K] extends ConditionDecl<infer W, infer Es>
    ? {
        readonly key: K;
        readonly when: W;
        readonly entities: PatchedEntities<Es, BehaviourOf<L, 'conditional', K>>;
        readonly actions: MemberOf<BehaviourOf<L, 'conditional', K>, 'actions'>;
      } & BehaviourSections<BehaviourOf<L, 'conditional', K>>
    : never;
}[keyof ConditionsOf<B>];

/** The normalised module shape of section 4.7, computed from the base and the module literal. */
export interface ModuleOf<B extends AnyModuleBase, L> {
  readonly kind: 'module';
  readonly id: B['id'];
  readonly version: B['version'];
  readonly base: B;
  readonly requires: ListOf<B, 'requires'>;
  readonly optional: ListOf<B, 'optional'>;
  readonly provides: ListOf<B, 'provides'>;
  readonly generates: ListOf<B, 'generates'>;
  readonly extensionPoints: MemberOf<B, 'extensionPoints'>;
  readonly entities: NormalisedEntities<B, L>;
  readonly actions: MemberOf<L, 'actions'>;
  readonly services: MemberOf<L, 'services'>;
  readonly effects: MemberOf<L, 'effects'>;
  readonly executors: MemberOf<L, 'executors'>;
  readonly policies: MemberOf<L, 'policies'>;
  readonly reactions: MemberOf<L, 'reactions'>;
  readonly fills: MemberOf<L, 'extensionPoints'>;
  readonly schedules: MemberOf<L, 'schedules'>;
  readonly lifecycle: MemberOf<L, 'lifecycle'>;
  readonly topics: MemberOf<L, 'topics'>;
  readonly changes: MemberOf<L, 'changes'>;
  /** Where the module ships its migration tracks; absent for a module without tables of its own (S-08). */
  readonly migrations?: URL;
  readonly contributes: readonly NormalisedContribution<B, L>[];
  readonly conditional: readonly NormalisedConditional<B, L>[];
}
