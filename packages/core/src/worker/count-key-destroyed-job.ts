import { metrics } from '@opentelemetry/api';
import type { Meter } from '../observability/meter.ts';

/**
 * Counts one job that ended unrun on `keelwerk.jobs.key_destroyed`, by queue (a queue name is a
 * module's, never a value), because the data key of one of its personal members was destroyed by an
 * erasure. The meter is the process's unless one is given.
 */
export function countKeyDestroyedJob(
  queue: string,
  meter: Meter = metrics.getMeter('keelwerk'),
): void {
  meter
    .createCounter('keelwerk.jobs.key_destroyed', {
      description: 'Jobs that ended unrun because the data key of a personal member was destroyed.',
    })
    .add(1, { queue });
}
