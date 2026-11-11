/**
 * The queues whose jobs are actions the invoker runs, in registration order. `'*'` in a process's
 * slots gives each of them its own count (21.1). Later work packages append their queues here:
 * 'schedules' and 'timers' with the schedule ticker. 'reactions' holds the jobs of async reactions.
 */
export const actionQueues: readonly string[] = ['commands', 'reactions'];
