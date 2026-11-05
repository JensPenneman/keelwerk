import { DryRunRollback } from '../explain/dry-run-rollback.ts';
import type { ScopeTarget } from '../invoker/scope-target.ts';
import type { KeyService } from '../kernel/key-service.ts';
import { bucketKey } from './bucket-key.ts';
import type { ModuleCharge } from './module-charge.ts';
import { tokenBucketPolicy } from './token-bucket-policy.ts';

/** How a set of charges is applied. */
export interface ChargeOptions {
  /** Takes the tokens in a unit that always rolls back, so the answer is real and the buckets are untouched (dry run). */
  readonly rollback?: boolean;
}

/**
 * Takes every charge from the target scope's bucket store in one short read-write unit, and
 * answers the longest wait among the refused ones in seconds; undefined when every take
 * succeeded. A refusal does not stop the later takes: each attempt counts against every bucket it
 * names. The keyed hashes are derived before the unit opens, because a key-cache miss opens a
 * control-store unit of its own, and the takes run in hash order so two invocations naming the
 * same buckets never lock them in opposite orders.
 */
export async function takeCharges(
  target: ScopeTarget,
  keys: KeyService,
  charges: readonly ModuleCharge[],
  options: ChargeOptions = {},
): Promise<number | undefined> {
  const keyed = await Promise.all(
    charges.map(async ({ module, charge }) => ({
      key: await bucketKey(keys, target.scope, module, charge.bucket),
      policy: tokenBucketPolicy(charge),
    })),
  );
  keyed.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const held: { wait?: number } = {};
  try {
    await target.handle.adapter.unit(target.namespace, target.scope, async (unit) => {
      for (const { key, policy } of keyed) {
        const taken = await unit.buckets.take(key, policy.cost, {
          capacity: policy.capacity,
          refillPerSecond: policy.refillPerSecond,
        });
        if (!taken.ok) held.wait = Math.max(held.wait ?? 0, taken.retryAfter ?? 1);
      }
      if (options.rollback === true) throw new DryRunRollback();
    });
  } catch (error) {
    if (!(error instanceof DryRunRollback)) throw error;
  }
  return held.wait;
}
