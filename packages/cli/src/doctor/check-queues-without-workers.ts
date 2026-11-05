import type { QueueFact } from './deployment-facts.ts';
import type { DoctorFinding } from './doctor-finding.ts';
import { findingOf } from './finding-of.ts';

/**
 * Queues that hold work and have no worker (section 9.5.6, S-24). M1 runs no worker, so a queue
 * with jobs and no process in the `work` role is expected there; doctor still names it.
 */
export function checkQueuesWithoutWorkers(queues: readonly QueueFact[]): readonly DoctorFinding[] {
  return queues
    .filter((queue) => queue.queued + queue.running > 0 && queue.workers === 0)
    .map((queue) =>
      findingOf(
        'queues',
        'warning',
        queue.name,
        `queue ${queue.name} holds ${queue.queued + queue.running} job(s) and no process works it`,
        `declare a process with the work role and slots for ${queue.name} (section 21.1)`,
      ),
    );
}
