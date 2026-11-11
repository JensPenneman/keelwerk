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
  /**
   * The instance key; jobs are FIFO per instance. It is a function of the event alone: it receives
   * the event without `current` (the row moves between the dispatch and the run, and a `changed`
   * event carries only the changed fields, so read what names the instance from the stream or from
   * data). The dispatcher computes it once, when it queues the job, and the job carries the id of the
   * instance's stream, derived from it with a one-way function: the job never computes the key again,
   * so a deploy that changes this function leaves the jobs already queued on their instances (only
   * the events dispatched after it fall on the new ones). It must not return a personal value: it is
   * stored only as a hash (in the job key) and inside the derived stream id, and nothing erases
   * those with a subject. The one exception is the process that declares `dataSubject:
   * 'instanceKey'`: its key is then the id of the data subject (a lower-case UUID, no value about
   * the person), and the job keeps it only sealed under that subject's own key, so erasing the
   * subject also ends the jobs still queued for it: they decide nothing.
   */
  readonly key: (
    event: ReactionEventOf<S, On, 'async'> extends infer E
      ? E extends unknown
        ? Omit<E, 'current'>
        : never
      : never,
  ) => string;
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
  /**
   * Says that the personal members of the process's events belong to one data subject: the one the
   * instance key names, so erasing that subject shreds them. Without it a process may hold no
   * personal member; the only value today is `'instanceKey'`. The instance key then is the id of
   * the data subject and must be a lower-case UUID: the dispatcher checks it where the key is first
   * known, and an instance key that is none makes that process's job fail with
   * `core.process_instance_key_invalid`, no other reaction held back.
   */
  readonly dataSubject?: 'instanceKey';
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
