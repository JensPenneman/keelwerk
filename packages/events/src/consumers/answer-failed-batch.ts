import type { ScopeTarget } from '@keelwerk/core';
import { isKeelwerkError } from '@keelwerk/core';
import type { FailedBatchState } from './failed-batch-state.ts';
import { parkOnFailure } from './park-on-failure.ts';
import type { ScopeBatchResult } from './scope-batch-result.ts';

/**
 * What the runner does after a batch of a scope failed (D3, D5): a failure outside `consume` or a
 * limit holds the scope and counts nothing; a failed batch that read several events is retried one
 * event at a time; an event that fails `maxAttempts` times parks its stream and the checkpoint moves
 * past it.
 */
export async function answerFailedBatch(
  state: FailedBatchState,
  scopeId: string,
  target: ScopeTarget,
  result: Extract<ScopeBatchResult, { readonly kind: 'failed' }>,
): Promise<void> {
  const { spec, maxAttempts, holdMs, log, singles, failing, hold, enqueue } = state;
  const { error, events } = result;
  const [first] = events;
  if (first === undefined) {
    log.warn('a consumer batch failed outside the consumer', {
      consumer: spec.id,
      scope: scopeId,
      cause: error,
    });
    hold(scopeId, holdMs);
    return;
  }
  if (isKeelwerkError(error) && (error.kind === 'rate_limited' || error.kind === 'unavailable')) {
    // The consumer asked for time: the batch rolled back, nothing counts (D3).
    hold(scopeId, error.retryAfter === undefined ? holdMs : Math.ceil(error.retryAfter * 1000));
    return;
  }
  if (result.read > 1) {
    // Every event the batch read is retried alone, those of parked streams too: their records
    // rolled back with the batch and are written again by the single-event batches.
    if (result.readTo !== null) singles.set(scopeId, result.readTo);
    log.warn('a consumer batch failed; its events are retried one at a time', {
      consumer: spec.id,
      scope: scopeId,
      events: result.read,
      cause: error,
    });
    enqueue(scopeId);
    return;
  }
  const before = failing.get(scopeId);
  const count = before?.eventId === first.eventId ? before.count + 1 : 1;
  if (count < maxAttempts) {
    failing.set(scopeId, { eventId: first.eventId, count });
    log.warn('a consumer failed on an event and tries it again', {
      consumer: spec.id,
      scope: scopeId,
      event: first.eventId,
      attempt: count,
      cause: error,
    });
    enqueue(scopeId);
    return;
  }
  failing.delete(scopeId);
  try {
    await parkOnFailure({ spec, target, scopeId, event: first, error });
    log.error('a consumer gave up on an event and parked its stream', {
      consumer: spec.id,
      scope: scopeId,
      stream: first.stream,
      event: first.eventId,
      position: String(first.position),
      attempts: count,
      cause: error,
    });
    enqueue(scopeId);
  } catch (cause) {
    log.warn('a stream could not be parked', { consumer: spec.id, scope: scopeId, cause });
    hold(scopeId, holdMs);
  }
}
