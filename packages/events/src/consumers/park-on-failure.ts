import type { ConsumerSpec, ScopeTarget, StoredEvent } from '@keelwerk/core';
import { lockCheckpoint } from './lock-checkpoint.ts';
import { parkedError } from './parked-error.ts';

/**
 * Parks the stream of an event the consumer gave up on and advances the checkpoint to it, in one
 * unit (D5). When the checkpoint already reached the event another runner got there first and
 * nothing is written.
 */
export async function parkOnFailure(input: {
  readonly spec: ConsumerSpec;
  readonly target: ScopeTarget;
  readonly scopeId: string;
  readonly event: StoredEvent;
  readonly error: unknown;
}): Promise<void> {
  const { spec, target, scopeId, event, error } = input;
  await target.handle.adapter.unit(target.namespace, target.scope, async (unit) => {
    const at = await lockCheckpoint(unit, spec.id, scopeId);
    if (at !== null && at >= event.position) return;
    await unit.consumers.park(spec.id, event.stream, event.position, parkedError(error, event));
    await unit.consumers.advance(spec.id, scopeId, event.position);
  });
}
