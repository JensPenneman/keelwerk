import type { MemoryJob } from './memory-job.ts';

/**
 * Whether a job waits to run (section 9.5.5): scheduled for later, available now, or waiting behind
 * the earlier job of its key; never a running or a dead job. The one place the set is written for
 * the memory adapter: the queue statistics, `JobStore.queued`, the queued cap of the commit tail,
 * the key policy and a cancel read it.
 */
export function memoryJobIsQueued(job: MemoryJob): boolean {
  return job.state === 'scheduled' || job.state === 'available' || job.state === 'waiting';
}
