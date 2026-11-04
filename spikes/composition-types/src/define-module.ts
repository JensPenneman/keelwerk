import type { AnyActionPart } from './action-part.ts';
import type { AnyModule } from './any-module.ts';
import type {
  ConditionsOf,
  ContributionsOf,
  EntitiesOf,
  EntityNames,
  FieldsOf,
  ListOf,
  RelationsOf,
} from './base-members.ts';
import type { Check } from './check.ts';
import type { ConditionDecl } from './define-condition.ts';
import type { ContributionDecl } from './define-contribution.ts';
import type { AnyModuleBase } from './define-module-base.ts';
import type { Within } from './within.ts';

type MemberOf<T, K extends string> = T extends { readonly [P in K]: infer V } ? V : {};
type EntityActionsIn<L, E> =
  MemberOf<L, 'entityActions'> extends infer Ea ? (E extends keyof Ea ? Ea[E] : {}) : {};
type BehaviourOf<L, Sec extends string, K> =
  MemberOf<L, Sec> extends infer Bh ? (K extends keyof Bh ? Bh[K] : {}) : {};

type NormalisedEntities<B, L> = {
  readonly [E in keyof EntitiesOf<B>]: EntitiesOf<B>[E] & {
    readonly actions: EntityActionsIn<L, E>;
  };
};
type PatchedEntities<Es, Bh> = {
  readonly [E in keyof Es | keyof MemberOf<Bh, 'entityActions'>]: {
    readonly fields: E extends keyof Es ? FieldsOf<Es[E]> : {};
    readonly relations: E extends keyof Es ? RelationsOf<Es[E]> : {};
    readonly actions: EntityActionsIn<Bh, E>;
  };
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
      }
    : never;
}[keyof ContributionsOf<B>];
type NormalisedConditional<B, L> = {
  [K in keyof ConditionsOf<B>]: ConditionsOf<B>[K] extends ConditionDecl<infer W, infer Es>
    ? {
        readonly key: K;
        readonly when: W;
        readonly entities: PatchedEntities<Es, BehaviourOf<L, 'conditional', K>>;
        readonly actions: MemberOf<BehaviourOf<L, 'conditional', K>, 'actions'>;
      }
    : never;
}[keyof ConditionsOf<B>];

interface Mounted<S, M> {
  readonly source: S;
  readonly mount: M;
}
type PartsAt<S, M> = { readonly [name: string]: Mounted<S, M> };
type SourcedBy<S> = { readonly [name: string]: { readonly source: S } };
type ContributionTargetEntities<B, K> = K extends keyof ContributionsOf<B>
  ? ContributionsOf<B>[K] extends { readonly to: infer To }
    ? EntityNames<To>
    : never
  : never;
interface BehaviourMounts<S, Es extends string> {
  readonly actions?: PartsAt<S, null>;
  readonly entityActions?: { readonly [E in Es]?: PartsAt<S, E> };
  readonly policies?: { readonly [target: string]: SourcedBy<S> };
  readonly reactions?: SourcedBy<S>;
  readonly extensionPoints?: SourcedBy<S>;
}
type MountsFor<B extends AnyModuleBase> = BehaviourMounts<B, EntityNames<B>> & {
  readonly services?: SourcedBy<B>;
  readonly lifecycle?: SourcedBy<B>;
  readonly effects?: SourcedBy<B>;
  readonly executors?: SourcedBy<B>;
  readonly schedules?: SourcedBy<B>;
  readonly contributes?: {
    readonly [K in keyof ContributionsOf<B>]?: BehaviourMounts<
      Within<B, K & string, 'contributions'>,
      ContributionTargetEntities<B, K>
    >;
  };
  readonly conditional?: {
    readonly [K in keyof ConditionsOf<B>]?: BehaviourMounts<
      Within<B, K & string, 'conditions'>,
      EntityNames<B>
    >;
  };
};

/** An executor mounted under a key whose effect is a different one, or no effect at all. */
type MismatchedExecutors<L> = {
  [K in keyof MemberOf<L, 'executors'>]: MemberOf<L, 'executors'>[K] extends {
    readonly effect: infer E;
  }
    ? K extends keyof MemberOf<L, 'effects'>
      ? [E] extends [MemberOf<L, 'effects'>[K]]
        ? never
        : K & string
      : K & string
    : never;
}[keyof MemberOf<L, 'executors'>];

type Parts = { readonly [name: string]: object };
type Actions = { readonly [name: string]: AnyActionPart };

/** The behaviour half of a contribution or conditional part. */
export interface Behaviour {
  readonly actions?: Actions;
  readonly entityActions?: { readonly [entity: string]: Actions };
  readonly policies?: { readonly [target: string]: Parts };
  readonly reactions?: Parts;
  readonly extensionPoints?: Parts;
}

/** The module literal: mounts the parts under keys that are ids (section 4.1). */
export interface ModuleLiteral extends Behaviour {
  readonly services?: Parts;
  readonly topics?: Parts;
  readonly contributes?: { readonly [key: string]: Behaviour };
  readonly conditional?: { readonly [key: string]: Behaviour };
  readonly schedules?: Parts;
  readonly lifecycle?: Parts;
  readonly changes?: Parts;
  readonly effects?: Parts;
  readonly executors?: Parts;
}

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
  readonly contributes: readonly NormalisedContribution<B, L>[];
  readonly conditional: readonly NormalisedConditional<B, L>[];
}

/** The named type of a module value: the identity; extending it in an interface gives emit a name (section 13.11). */
export type ModuleType<T extends AnyModule> = T;

/**
 * Mounts the parts typed against `base`. A part is accepted only where its base and mount match:
 * `entityActions: { session: { revoke } }` fails when `revoke` is mounted on `credential`.
 */
export function defineModule<const B extends AnyModuleBase, const L extends ModuleLiteral>(
  base: B,
  literal: L & MountsFor<B> & Check<MismatchedExecutors<L>, 'executorsWithoutEffect'>,
): ModuleOf<B, L> {
  const entities = Object.fromEntries(
    Object.entries(base.entities ?? {}).map(([name, entity]) => [
      name,
      { ...entity, actions: literal.entityActions?.[name] ?? {} },
    ]),
  );
  const contributes = Object.entries(base.contributions ?? {}).map(([key, declaration]) => ({
    key,
    to: declaration.to,
    when: declaration.when,
    entities: declaration.entities,
    actions: literal.contributes?.[key]?.actions ?? {},
  }));
  const conditional = Object.entries(base.conditions ?? {}).map(([key, declaration]) => ({
    key,
    when: declaration.when,
    entities: declaration.entities,
    actions: literal.conditional?.[key]?.actions ?? {},
  }));
  return {
    kind: 'module',
    id: base.id,
    version: base.version,
    base,
    requires: base.requires ?? [],
    optional: base.optional ?? [],
    provides: base.provides ?? [],
    generates: base.generates ?? [],
    extensionPoints: base.extensionPoints ?? {},
    entities,
    actions: literal.actions ?? {},
    services: literal.services ?? {},
    effects: literal.effects ?? {},
    executors: literal.executors ?? {},
    contributes,
    conditional,
  } as unknown as ModuleOf<B, L>;
}
