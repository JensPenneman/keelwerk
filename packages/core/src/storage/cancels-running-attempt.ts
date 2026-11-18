import { hookQueue } from '../control/hook-queue.ts';
import { timerQueue } from '../effects/timer-queue.ts';

/**
 * Whether `JobStore.cancel` also cancels the attempt that is running in this queue. It does in the
 * queues whose jobs never cross scopes and whose command commits in the unit that completes the
 * job (timers and hooks), so the cancel rolls that unit back and exactly one of the two commits. In
 * every other queue a running job is left to finish: its command may commit in another scope's unit.
 */
export function cancelsRunningAttempt(queue: string): boolean {
  return queue === timerQueue || queue === hookQueue;
}
