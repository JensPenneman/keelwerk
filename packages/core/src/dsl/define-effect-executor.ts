import type { ExecutorContext } from '../contexts/executor-context.ts';
import type { JobGroup } from '../jobs/job-group.ts';
import type { JobRetry } from '../jobs/job-retry.ts';
import type { ConfigOf } from '../model/config-of.ts';
import type { BaseOf, PartSource } from '../model/part-source.ts';
import type { AnyEffectPart } from './define-effect.ts';

/** Options of an effect executor (section 7.9.5). */
export interface EffectExecutorOptions<B, I, O> {
  readonly queue?: string;
  readonly capability?:
    | readonly string[]
    | ((c: { readonly config: ConfigOf<B>; readonly input: I }) => readonly string[]);
  readonly inline?: boolean;
  readonly timeout?: string;
  readonly group?: (c: { readonly config: ConfigOf<B>; readonly input: I }) => JobGroup;
  readonly retry?: JobRetry;
  readonly run: (input: I, ctx: ExecutorContext<B>) => Promise<O>;
}

/** An executor part. */
export interface ExecutorPart<S, E> {
  readonly kind: 'executor';
  readonly source: S;
  readonly effect: E;
  readonly options: object;
}

/** Declares the executor of an effect: the only imperative module code. */
export function defineEffectExecutor<const S extends PartSource, const E extends AnyEffectPart>(
  source: S,
  effect: E,
  options: EffectExecutorOptions<
    BaseOf<S>,
    NonNullable<E['~types']>['input'],
    NonNullable<E['~types']>['output']
  >,
): ExecutorPart<S, E> {
  return { kind: 'executor', source, effect, options };
}
