import { isKeelwerkError } from '../errors/is-keelwerk-error.ts';
import type { RunJobContext } from '../worker/run-job.ts';
import { attemptErrorOf } from './attempt-error-of.ts';
import type { BeganAttempt } from './begin-effect-attempt.ts';
import { declaredErrorCodesOf } from './declared-error-codes-of.ts';
import type { EffectAttemptJob } from './effect-attempt-job.ts';
import { recordAttempt } from './record-attempt.ts';

/**
 * Closes the start record of an attempt whose executor was never called (21.6 step 4): in one unit
 * of the job's scope it appends the end record (process, build, attempt, the start of `began`, the
 * end now, the closed projection of `reason`). It completes no job: the drain releases the attempt,
 * or a taker reclaimed it, and the next take finds the attempt ended, so the effect is not settled
 * `abandoned` for an attempt that never reached its destination. Any failure is logged once (`warn`,
 * the code only) and swallowed: the open record then settles abandoned, as it did before.
 */
export async function closeUnrunAttempt(
  context: RunJobContext,
  target: EffectAttemptJob,
  began: Extract<BeganAttempt, { readonly kind: 'run' }>,
  reason: unknown,
): Promise<void> {
  const { stored, registry, effectId, entry, requestId } = target;
  const { source, worker, writer, clock } = context;
  const declared = declaredErrorCodesOf(registry, entry?.module);
  try {
    const error = attemptErrorOf(reason, requestId, declared);
    const endedAt = clock.now().toString();
    await source.handle.adapter.unit(source.namespace, stored.scope, (unit) =>
      recordAttempt(unit, registry, effectId, {
        process: worker,
        build: writer.build.id,
        attempt: stored.attempt.attempt,
        startedAt: began.startedAt,
        endedAt,
        error,
      }),
    );
  } catch (cause) {
    context.log.warn('the start record of an attempt that never ran could not be closed', {
      effect: effectId,
      code: isKeelwerkError(cause) ? cause.code : 'core.internal',
    });
  }
}
