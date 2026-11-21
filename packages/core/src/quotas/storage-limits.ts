import { errors } from '../errors/errors.ts';
import type { Registry } from '../registry/registry.ts';
import type { Scope } from '../storage/scope.ts';
import type { QuotaLimits } from './quota-limits.ts';

/** The storage limits of a scope (12.2): the bytes `core.eventBytes` counts and the rows `core.rows` counts. */
export interface StorageLimits {
  readonly eventBytes: bigint;
  readonly rows: bigint;
}

/**
 * The limits a command's writes may not exceed, or null when it has none: an exempt charge (the
 * admission's `isExemptFromAdmission` is a core action; the tail's `isExemptFromTail` is a core
 * action, or any action in a unit opened for a command with `prepare`), no quotas given, and a
 * deployment scope, which counts nothing. The one place that reads them for the commit tail
 * (`chargeStorage`) and for the admission of a command with `prepare` (`admitPrepare`).
 */
export function storageLimits(input: {
  readonly registry: Registry;
  readonly scope: Scope;
  readonly quotas: QuotaLimits | undefined;
  readonly exempt: boolean;
}): StorageLimits | null {
  const { registry, scope, quotas, exempt } = input;
  if (exempt || quotas === undefined || scope.level === 'deployment') return null;
  const limitOf = (ref: string): bigint => {
    const limit = quotas.limitOf(registry, scope, ref);
    if (limit.kind === 'rate')
      throw errors.internal(`the quota "${ref}" is a rate, not a storage limit`);
    return BigInt(limit.value);
  };
  return { eventBytes: limitOf('core.eventBytes'), rows: limitOf('core.rows') };
}
