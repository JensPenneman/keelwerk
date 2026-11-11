import type { JobQueue } from '../jobs/job-queue.ts';
import type { KernelQueue } from './kernel-queue.ts';

/** Whether the deployment's queue is the kernel's own, which hands out its source and its probe. */
export function isKernelQueue(queue: JobQueue): queue is KernelQueue {
  return 'sourceOf' in queue && typeof queue.sourceOf === 'function' && 'probe' in queue;
}
