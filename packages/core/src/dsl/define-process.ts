import type { DecideContext } from '../contexts/decide-context.ts';
import type { Shape } from '../fields/shape.ts';
import type { ShapeValue } from '../fields/shape-value.ts';
import type { JobRetry } from '../jobs/job-retry.ts';
import type { BaseOf, OwnerOf, PartSource, WhenOf } from '../model/part-source.ts';
import type { Decision } from '../protocol/decision.ts';
import type { EventDraft } from '../protocol/event-draft.ts';
import type { Gen } from '../protocol/gen.ts';
import type { EventShapes } from './define-entity.ts';
import type { EventRefsOf, ReactionEventOf } from './define-reaction.ts';

/** The event `evolve` folds: one of the process's own events. */
export type ProcessEventOf<Pe extends EventShapes, I extends string> = {
  [N in keyof Pe & string]: {
    readonly type: N;
    readonly data: Pe[N] extends Shape<infer F> ? ShapeValue<F, I, 'stored'> : never;
    readonly version: number;
  };
}[keyof Pe & string];

/** `ctx.events` of a process: drafts for its own stream; the kernel sets stream and instance id (S-124). */
export type ProcessEventDrafts<Pe extends EventShapes, I extends string> = {
  readonly [N in keyof Pe]: (
    payload: Pe[N] extends Shape<infer F> ? ShapeValue<F, I, 'draft'> : never,
  ) => EventDraft;
};

/** The literal of a process manager (section 7.7). */
export interface ProcessSpec<S, On extends string, Pe extends EventShapes, St> {
  readonly on: readonly On[];
  /** The instance key; jobs are FIFO per instance. */
  readonly key: (event: ReactionEventOf<S, On, 'async'>) => string;
  readonly events: Pe;
  readonly initial: St;
  readonly evolve: (state: St, event: ProcessEventOf<Pe, OwnerOf<S>>) => St;
  readonly react: (
    event: ReactionEventOf<S, On, 'async'>,
    state: St,
    ctx: DecideContext<BaseOf<S>, WhenOf<S>> & {
      readonly events: ProcessEventDrafts<Pe, OwnerOf<S>>;
    },
  ) => Decision | Gen<Decision>;
  readonly concurrency?: number;
  readonly retry?: JobRetry;
}

/** A process part, mounted as `reactions.<name>`. */
export interface ProcessPart<S> {
  readonly kind: 'process';
  readonly source: S;
  readonly on: readonly string[];
  readonly spec: object;
}

/** A process manager (section 7.7): an async reaction with its own state stream per instance. */
export function defineProcess<
  const S extends PartSource,
  const On extends EventRefsOf<S>,
  const Pe extends EventShapes,
  St,
>(source: S, spec: ProcessSpec<S, On, Pe, St>): ProcessPart<S> {
  return { kind: 'process', source, on: spec.on, spec };
}
