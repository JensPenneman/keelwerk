import type { ScopeTarget } from '../invoker/scope-target.ts';
import type { KeyService } from '../kernel/key-service.ts';
import { bucketKey } from './bucket-key.ts';
import type { ModuleCharge } from './module-charge.ts';
import { tokenBucketPolicy } from './token-bucket-policy.ts';

/**
 * Reads whether every charge could be taken now, in one read-only unit of the target scope, and
 * answers the longest wait among the buckets that lack their cost in seconds; undefined when all
 * have it. Nothing is taken, so a failure-only bucket can refuse the next attempt before the
 * action runs while the charge itself still waits for a declared failure (section 12.2).
 */
export async function checkCharges(
  target: ScopeTarget,
  keys: KeyService,
  charges: readonly ModuleCharge[],
): Promise<number | undefined> {
  const keyed = await Promise.all(
    charges.map(async ({ module, charge }) => ({
      key: await bucketKey(keys, target.scope, module, charge.bucket),
      policy: tokenBucketPolicy(charge),
    })),
  );
  return target.handle.adapter.unit(
    target.namespace,
    target.scope,
    async (unit) => {
      let wait: number | undefined;
      for (const { key, policy } of keyed) {
        const read = await unit.buckets.check(key, policy.cost, {
          capacity: policy.capacity,
          refillPerSecond: policy.refillPerSecond,
        });
        if (!read.ok) wait = Math.max(wait ?? 0, read.retryAfter ?? 1);
      }
      return wait;
    },
    { readOnly: true },
  );
}
