import { coreErrorCodes, KeelwerkError } from '@keelwerk/core';

/**
 * The refusal of an enqueue that leaves more queued jobs (section 9.5.5) in a queue than its cap:
 * retry in a second. `value` is the count the unit left, read up to the cap plus one.
 */
export function queueFull(queue: string, limit: number, value: number): KeelwerkError {
  return new KeelwerkError({
    ...coreErrorCodes['core.queue_full'],
    code: 'core.queue_full',
    retryAfter: 1,
    details: { queue, limit, value },
  });
}
