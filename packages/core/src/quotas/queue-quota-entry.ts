import type { QuotaEntry } from '../registry/quota-entry.ts';
import type { DeploymentDefinition } from '../runtime/deployment-definition.ts';
import type { QueueLimits } from './queue-limits.ts';

const defaultRunning = 4;
const defaultQueued = 10_000;
const defaultWeight = 1;

/**
 * The synthetic entry of `queue:<queue>.<member>`: a count at tenant level whose default is the
 * deployment's setting for the queue (running 4, queued 10,000 and weight 1 when it names none).
 */
export function queueQuotaEntry(
  queue: string,
  member: keyof QueueLimits,
  queues: DeploymentDefinition['queues'],
): QuotaEntry {
  const ref = `queue:${queue}.${member}`;
  const configured = queues?.[queue];
  const value =
    member === 'running'
      ? (configured?.running ?? defaultRunning)
      : member === 'queued'
        ? (configured?.queued ?? defaultQueued)
        : defaultWeight;
  return { ref, module: 'core', name: ref, kind: 'count', default: value, level: 'tenant' };
}
