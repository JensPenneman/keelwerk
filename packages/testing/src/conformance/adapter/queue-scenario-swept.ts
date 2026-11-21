import type { QueueScenarioWorker } from './queue-scenario-worker.ts';

/**
 * Wakes every worker and waits until each has finished a sweep that began after the wake: a worker
 * that holds no attempt is idle only when no sweep is pending. Rejects after 30 s.
 */
export async function queueScenarioSwept(workers: readonly QueueScenarioWorker[]): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('a worker did not finish its sweep')), 30_000);
  });
  try {
    await Promise.race([
      Promise.all(
        workers.map(async (each) => {
          each.queue.probe.wake();
          await each.queue.probe.idle();
        }),
      ),
      limit,
    ]);
  } finally {
    clearTimeout(timer);
  }
}
