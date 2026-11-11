import { errors } from '../errors/errors.ts';
import type { JobQueue } from '../jobs/job-queue.ts';
import type { RuntimeService } from '../runtime/runtime-service.ts';
import type { StartPhaseInput } from '../runtime/start-phase-input.ts';
import { workRole } from '../runtime/work-role.ts';
import type { KernelQueue } from './kernel-queue.ts';
import { runJob } from './run-job.ts';

function isKernelQueue(queue: JobQueue): queue is KernelQueue {
  return 'sourceOf' in queue && typeof queue.sourceOf === 'function' && 'probe' in queue;
}

/**
 * The kernel's workers (`core.workers`, S-154): in a process with the `work` role, `start` runs
 * the kernel queue's `work` for each queue the process slots (`workRole`), each job through
 * `runJob`; `stop` drains every fetcher by the deadline, so attempts running at that moment finish
 * and what is still running is aborted and left to its lease (D6, interim: 21.6 step 4 releases it
 * without counting the attempt, which waits for a release member on the job store). When the process
 * is torn down before the deadline, the same happens at once: nothing is released, the leases expire.
 */
export function createWorker(input: StartPhaseInput): RuntimeService {
  const handles: { drain(deadline: Temporal.Instant): Promise<number> }[] = [];
  const { connected, invoker, clock } = input;
  return {
    id: 'core.workers',
    roles: ['work'],
    start: async (context) => {
      const { queue } = context;
      if (!isKernelQueue(queue)) throw errors.internal('The workers need the kernel queue.');
      const role = workRole(input);
      for (const [name, slots] of role.slots) {
        handles.push(
          await queue.work(
            name,
            (job) =>
              runJob(job, {
                invoker,
                worker: connected.processId,
                source: queue.sourceOf(job),
                writer: connected.control.writer,
                clock,
                random: Math.random,
                log: connected.log,
              }),
            { slots, capabilitySets: role.capabilitySets, revision: role.revision },
          ),
        );
      }
      context.signal.addEventListener(
        'abort',
        () => {
          const now = Temporal.Now.instant();
          for (const handle of handles) void handle.drain(now);
        },
        { once: true },
      );
    },
    stop: async (deadline) => {
      const left = await Promise.all(handles.map((handle) => handle.drain(deadline)));
      const unfinished = left.reduce((sum, count) => sum + count, 0);
      if (unfinished > 0) {
        connected.log.warn(
          'attempts were still running at the deadline; their leases will expire',
          {
            attempts: unfinished,
          },
        );
      }
    },
  };
}
