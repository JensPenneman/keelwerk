/**
 * The stored key of a timer (9.5.1 `key`): the id of the module that set it, a colon, and the key
 * as that module wrote it. The one place a timer key is built: `setTimer` and `cancelTimer` of a
 * decision (the decision's module), a principal resolver's `setTimer` (the resolver's module).
 * A module id holds no colon (5.1), so the same key text in two modules names two timers, and a
 * module reaches only its own. `enqueueKey` follows the same rule for a keyed enqueue, and the
 * kernel's deadline key is `deadlineTimerKey`.
 */
export function timerKey(module: string, key: string): string {
  return `${module}:${key}`;
}
