import { hookQueue } from '../control/hook-queue.ts';
import { commandQueue } from '../effects/command-queue.ts';
import { timerQueue } from '../effects/timer-queue.ts';
import { KeelwerkError } from '../errors/keelwerk-error.ts';
import { reactionQueue } from '../reactions/reaction-queue.ts';
import type { QuotaEntry } from '../registry/quota-entry.ts';
import type { Registry } from '../registry/registry.ts';
import type { DeploymentDefinition } from '../runtime/deployment-definition.ts';
import { scheduleQueue } from '../schedules/schedule-queue.ts';
import { canonicalQuotaValue } from './canonical-quota-value.ts';
import { parseQuotaValue } from './parse-quota-value.ts';
import type { QueueLimits } from './queue-limits.ts';
import { queueMemberBounds } from './queue-member-bounds.ts';
import { queueQuotaEntry } from './queue-quota-entry.ts';
import type { QuotaLimit } from './quota-limit.ts';

const queueDimension = /^queue:([^@]+)\.(running|queued|weight)$/;
const kernelQueues: readonly string[] = [
  commandQueue,
  reactionQueue,
  scheduleQueue,
  timerQueue,
  hookQueue,
];

function refuse(message: string): KeelwerkError {
  return new KeelwerkError({ kind: 'validation', code: 'core.malformed_request', message });
}

function sameLimit(a: QuotaLimit, b: QuotaLimit): boolean {
  if (a.kind === 'rate' && b.kind === 'rate') {
    return a.capacity === b.capacity && a.refillPerSecond === b.refillPerSecond;
  }
  return a.kind !== 'rate' && b.kind === a.kind && a.value === b.value;
}

/**
 * One limit text of one dimension, checked: the dimension names a queue of the deployment (a
 * configured queue, a kernel queue or the queue of an executor of the app) or a quota the app
 * declares; `default` is no limit (`limit: null`); any other text parses for the dimension's kind,
 * and a queue's running and weight are at most `queueMemberBounds.max` and its weight at least
 * `queueMemberBounds.minWeight`. `canonical` is the text to store, and a limit whose canonical text
 * would not read back to the same limit is refused. Every refusal is `validation`
 * `core.malformed_request`. Shared by `core.quota.set` and the creation of a backend.
 */
export function checkedQuotaValue(input: {
  readonly dimension: string;
  readonly limit: string;
  readonly appId: string;
  readonly registry: Pick<Registry, 'quotas' | 'executors'>;
  readonly queues: DeploymentDefinition['queues'];
}): {
  readonly entry: QuotaEntry;
  readonly limit: QuotaLimit | null;
  readonly canonical: string;
} {
  const { dimension, registry, queues } = input;
  const queue = queueDimension.exec(dimension);
  const queueName = queue?.[1];
  const member = queue?.[2] as keyof QueueLimits | undefined;
  let entry: QuotaEntry | undefined;
  if (queueName !== undefined && member !== undefined) {
    const known =
      Object.hasOwn(queues ?? {}, queueName) ||
      kernelQueues.includes(queueName) ||
      [...registry.executors.values()].some((executor) => executor.queue === queueName);
    if (!known) throw refuse(`"${queueName}" is not a queue of this deployment.`);
    entry = queueQuotaEntry(queueName, member, queues);
  } else {
    entry = registry.quotas.get(dimension);
  }
  if (entry === undefined) {
    throw refuse(`"${dimension}" is not a quota dimension of app "${input.appId}".`);
  }
  if (input.limit === 'default') return { entry, limit: null, canonical: 'default' };
  const limit = parseQuotaValue(entry.kind, input.limit);
  if (member !== undefined && member !== 'queued' && limit.kind === 'count') {
    if (limit.value > queueMemberBounds.max) {
      throw refuse(`${entry.ref} is above ${queueMemberBounds.max}.`);
    }
    if (member === 'weight' && limit.value < queueMemberBounds.minWeight) {
      throw refuse(`${entry.ref} is below ${queueMemberBounds.minWeight}.`);
    }
  }
  const canonical = canonicalQuotaValue(limit);
  if (!sameLimit(limit, parseQuotaValue(entry.kind, canonical))) {
    throw refuse(`${JSON.stringify(input.limit)} cannot be stored as a ${entry.kind} quota.`);
  }
  return { entry, limit, canonical };
}
