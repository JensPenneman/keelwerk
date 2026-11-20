import { bucketKey } from '../admission/bucket-key.ts';
import type { AdmissionRun } from '../admission/run-admission.ts';
import { errors } from '../errors/errors.ts';
import { KeelwerkError } from '../errors/keelwerk-error.ts';
import type { InvokerEnv } from '../invoker/invoker-env.ts';
import type { Principal } from '../principals/principal.ts';
import { clientAddressBucket } from './client-address-bucket.ts';
import { createProcessAllowance } from './create-process-allowance.ts';
import type { ProcessAllowance, RateBucket } from './process-allowance.ts';

/** One allowance per invoker: the tokens a process holds of the shared buckets (decision 156). */
const allowances = new WeakMap<InvokerEnv, ProcessAllowance>();

const bucketModule = 'core';

const classRate = {
  command: 'core.commandRate',
  query: 'core.queryRate',
  subscription: 'core.subscribeRate',
} as const;

/**
 * The name of the principal's own bucket: an anonymous caller is told apart by its client address,
 * an IPv6 address by its /64 and an IPv4-mapped address as its IPv4 address.
 */
function principalKeyOf(principal: Principal, address: string | undefined): string | undefined {
  switch (principal.kind) {
    case 'user':
      return `user:${String(principal.subject)}`;
    case 'service':
      return `service:${principal.id}`;
    case 'operator':
      return `operator:${principal.id}`;
    case 'anonymous':
      return address === undefined ? 'anonymous' : `anonymous:${clientAddressBucket(address)}`;
    default:
      return undefined;
  }
}

/**
 * The request rate of section 12.2 at `admit`: one token of the principal's
 * `core.principalRequestRate`, of the action class's rate and of the tenant's `core.requestRate`,
 * through the process's allowance, in that order; the first bucket that refuses stops the rest, so
 * a caller over its own rate spends nothing of the tenant's, and a refused request takes no token
 * of the shared buckets. An anonymous caller has the bucket of its client address, an IPv6 address
 * by its /64, or one shared bucket when the address is unknown. Refuses with `rate_limited`
 * `core.rate_limited` and `retryAfter`.
 */
export async function checkRequestRate(env: InvokerEnv, run: AdmissionRun): Promise<void> {
  const { quotas } = env.options;
  const { target } = run.details.resolved;
  if (quotas === undefined || run.details.carrier.job !== undefined) return;
  if (target === null || target.scope.level === 'deployment') return;
  await quotas.fresh();
  const { registry } = env.appOf(run.details.resolved.app);
  const names: { ref: string; bucket: string }[] = [];
  const principalKey = principalKeyOf(
    run.session.principal,
    run.invocation.carrier.connection?.remote.address,
  );
  if (principalKey !== undefined) {
    names.push({
      ref: 'core.principalRequestRate',
      bucket: `core.principalRequestRate:${principalKey}`,
    });
  }
  const kindRef = classRate[run.action.kind];
  names.push(
    { ref: kindRef, bucket: kindRef },
    { ref: 'core.requestRate', bucket: 'core.requestRate' },
  );
  const buckets: RateBucket[] = [];
  for (const { ref, bucket } of names) {
    const limit = quotas.limitOf(registry, target.scope, ref);
    if (limit.kind !== 'rate') {
      throw errors.internal(`The quota "${ref}" is not a rate.`);
    }
    buckets.push({
      key: await bucketKey(env.options.keys, target.scope, bucketModule, bucket),
      limit,
    });
  }
  let allowance = allowances.get(env);
  if (allowance === undefined) {
    allowance = createProcessAllowance({ clock: env.options.clock });
    allowances.set(env, allowance);
  }
  const wait = await allowance.take(target, buckets, run.dry === true);
  if (wait !== undefined) {
    throw new KeelwerkError({
      kind: 'rate_limited',
      code: 'core.rate_limited',
      message: 'Too many requests.',
      retryAfter: Math.ceil(wait),
    });
  }
}
