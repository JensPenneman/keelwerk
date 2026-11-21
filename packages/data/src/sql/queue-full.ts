import { coreErrorCodes, KeelwerkError } from '@keelwerk/core';

/**
 * The refusal of an enqueue that leaves more available jobs in a queue than its cap: retry in a
 * second.
 */
export function queueFull(queue: string, limit: number, value: number): KeelwerkError {
  return new KeelwerkError({
    ...coreErrorCodes['core.queue_full'],
    code: 'core.queue_full',
    retryAfter: 1,
    details: { queue, limit, value },
  });
}
