import type { Within } from '../dsl/within.ts';
import type { AnyModuleBase } from './any-module-base.ts';
import type { ConditionsOf } from './conditions-of.ts';
import type { ContributionsOf } from './contributions-of.ts';
import type { EntityNames } from './entities-of.ts';

interface Mounted<S, M> {
  readonly source: S;
  readonly mount: M;
}
type PartsAt<S, M> = { readonly [name: string]: Mounted<S, M> };
type SourcedBy<S> = { readonly [name: string]: { readonly source: S } };
type SourcedRule<S> = { readonly kind: 'rule'; readonly source: S };
type ContributionTargetEntities<B, K> = K extends keyof ContributionsOf<B>
  ? ContributionsOf<B>[K] extends { readonly to: infer To }
    ? EntityNames<To>
    : never
  : never;

/** What a behaviour section may mount: parts typed against the section's source, on the entities it can name. */
export interface BehaviourMounts<S, Es extends string> {
  readonly actions?: PartsAt<S, null>;
  readonly entityActions?: { readonly [E in Es]?: PartsAt<S, E> };
  readonly policies?: { readonly [target: string]: SourcedBy<S> | SourcedRule<S> };
  readonly reactions?: SourcedBy<S>;
  /** A point is filled by a part typed against the source, or by a list of values (a `set` point). */
  readonly extensionPoints?: {
    readonly [name: string]: { readonly source: S } | readonly unknown[];
  };
}

/** What the module literal may mount for base `B`: a part is accepted only where its source and mount match. */
export type MountsFor<B extends AnyModuleBase> = BehaviourMounts<B, EntityNames<B>> & {
  readonly services?: SourcedBy<B>;
  readonly lifecycle?: SourcedBy<B>;
  readonly effects?: SourcedBy<B>;
  readonly executors?: SourcedBy<B>;
  readonly schedules?: SourcedBy<B>;
  readonly topics?: SourcedBy<B>;
  readonly changes?: SourcedBy<B>;
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
