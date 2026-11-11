/**
 * The queues whose jobs are actions the invoker runs, in registration order. `'*'` in a process's
 * slots gives each of them its own count (21.1). Later work packages append their queues here:
 * 'schedules' and 'timers' with the schedule ticker, 'reactions' with the reaction dispatcher.
 */
export const actionQueues: readonly string[] = ['commands'];
