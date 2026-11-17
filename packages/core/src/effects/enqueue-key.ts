import { timerKey } from './timer-key.ts';

/**
 * The stored key of a keyed `enqueue` (12.3, 9.5.1 `key`): the id of the module that enqueued it,
 * a colon, and the key as that module wrote it, by the rule of `timerKey`. A decision's enqueue
 * uses the deciding module, a principal resolver's the module whose resolver returned it, so the
 * same key in two modules of one scope names two jobs and `keep` never reaches across modules.
 */
export function enqueueKey(module: string, key: string): string {
  return timerKey(module, key);
}
