import { trace } from '@opentelemetry/api';
import { errors } from '../errors/errors.ts';
import type { RuntimeService } from '../runtime/runtime-service.ts';
import type { StartPhaseInput } from '../runtime/start-phase-input.ts';
import { workRole } from '../runtime/work-role.ts';
import { isKernelQueue } from './is-kernel-queue.ts';
import { runJob } from './run-job.ts';

/**
 * The kernel's workers (`core.workers`, S-154): in a process with the `work` role, `start` runs
 * the kernel queue's `work` for each queue the process slots (`workRole`), each job through
 * `runJob`; `stop` drains every fetcher by the deadline, so attempts running at that moment finish
 * and what is still running is aborted and released (21.6 step 4): back to available with the
 * attempt not counted. The release records the job's queue as takeable (`JobStore.readied`; it
 * answers `undefined`, cannot name, when the job is in a group, so every queue of the namespace
 * wakes), so another worker is woken by the change feed and takes it at once; a feed that only
 * polls (notify off) leaves it to that worker's next poll. When the stop gives up at its own
 * deadline (`expire`), or the process is torn down before the deadline, or leaves service (the
 * abort of `context.signal`), the same happens at once.
 */
export function createWorker(input: StartPhaseInput): RuntimeService {
  const handles: { drain(deadline: Temporal.Instant): Promise<number> }[] = [];
  const { connected, invoker, clock, migrated } = input;
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
                keys: connected.keys,
                directory: migrated.directory.lookup,
                apps: input.apps,
                egress: input.options.work?.egress,
                tracer: trace.getTracer('keelwerk'),
                control: connected.control,
                ledgers: input.composed.infrastructure.ledgers,
                ...(input.restoreHold === undefined ? {} : { restoreHold: input.restoreHold }),
              }),
            { slots, capabilitySets: role.capabilitySets, revision: role.revision },
          ),
        );
      }
      // Draining at once, when the process is torn down or leaves service: the signal of a service
      // also aborts when the gate closes, even with its evidence pending, and no fetcher may take a
      // job meanwhile (an executor would run again on rows a restore brought back).
      const drainAll = (): void => {
        const now = Temporal.Now.instant();
        for (const handle of handles) void handle.drain(now);
      };
      if (context.signal.aborted) drainAll();
      else context.signal.addEventListener('abort', drainAll, { once: true });
    },
    // The fetchers log what a drain found still running and how much of it they released.
    stop: async (deadline) => {
      await Promise.all(handles.map((handle) => handle.drain(deadline)));
    },
    // The stop gave up at its deadline: what is still running is aborted and released now, while
    // the adapters are open. The same drain ends the waits of the one `stop` started.
    expire: async () => {
      await Promise.all(handles.map((handle) => handle.drain(Temporal.Now.instant())));
    },
  };
}
