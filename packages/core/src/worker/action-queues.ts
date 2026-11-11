/**
 * The queues whose jobs are actions the invoker runs, in registration order. `'*'` in a process's
 * slots gives each of them its own count (21.1). 'reactions' holds the jobs of async reactions,
 * 'schedules' the jobs of schedule ticks and 'timers' the keyed jobs of timers.
 */
export const actionQueues: readonly string[] = ['commands', 'reactions', 'schedules', 'timers'];
