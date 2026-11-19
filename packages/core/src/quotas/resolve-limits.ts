import type { QuotaRow } from '../control/control-quotas.ts';
import { errors } from '../errors/errors.ts';
import type { QuotaEntry } from '../registry/quota-entry.ts';
import type { Scope } from '../storage/scope.ts';
import { limitAbove } from './limit-above.ts';
import { parseQuotaValue } from './parse-quota-value.ts';
import type { QuotaLimit } from './quota-limit.ts';
import { quotaSlotOf } from './quota-slot-of.ts';

/** A tenant value never above the backend's, member by member. */
function clamped(limit: QuotaLimit, bound: QuotaLimit): QuotaLimit {
  if (limit.kind === 'rate' && bound.kind === 'rate') {
    return {
      kind: 'rate',
      capacity: Math.min(limit.capacity, bound.capacity),
      refillPerSecond: Math.min(limit.refillPerSecond, bound.refillPerSecond),
    };
  }
  return limitAbove(limit, bound) ? bound : limit;
}

/** Whether a row sits at the slot its own dimension, backend and tenant name. */
function rowMatchesSlot(row: QuotaRow, slot: string): boolean {
  return row.tenantId !== null && quotaSlotOf(row.dimension, row.backendId, row.tenantId) === slot;
}

/**
 * The limit of `entry` in `scope`. Deployment scope: the declared default. Backend scope, or an
 * entry counted at backend level: the backend's configured value (`backendQuotas`, by backend id
 * and dimension), else the default. Tenant scope: the tenant's row (by slot), clamped to the
 * backend's value member by member, else the backend's value. A row without `limit` is no
 * override; a row whose limit does not parse, or whose slot does not match its own dimension,
 * backend and tenant (a row without a tenant included), is passed to `skipped` and ignored; a
 * configured value that does not parse is passed to `skippedValue` and the default serves. A
 * default that does not parse is `internal`.
 */
export function resolveLimits(input: {
  readonly entry: QuotaEntry;
  readonly scope: Scope;
  readonly rows: ReadonlyMap<string, QuotaRow>;
  readonly backendQuotas: ReadonlyMap<string, ReadonlyMap<string, string>>;
  readonly skipped?: (row: QuotaRow, error: unknown) => void;
  readonly skippedValue?: (backendId: string, dimension: string, error: unknown) => void;
}): QuotaLimit {
  const { entry, scope, rows } = input;
  let fallback: QuotaLimit;
  try {
    fallback = parseQuotaValue(entry.kind, entry.default);
  } catch (error) {
    throw errors.internal(`The default of the quota ${entry.ref} does not parse.`, {
      cause: error,
    });
  }
  if (scope.level === 'deployment') return fallback;
  const configured = input.backendQuotas.get(scope.backendId)?.get(entry.ref);
  let backend = fallback;
  if (configured !== undefined) {
    try {
      backend = parseQuotaValue(entry.kind, configured);
    } catch (error) {
      input.skippedValue?.(scope.backendId, entry.ref, error);
    }
  }
  if (scope.level === 'backend' || entry.level === 'backend') return backend;
  const slot = quotaSlotOf(entry.ref, scope.backendId, scope.tenantId);
  const row = rows.get(slot);
  if (row === undefined) return backend;
  if (!rowMatchesSlot(row, slot)) {
    input.skipped?.(row, errors.internal(`The core.quota row ${row.id} does not match its slot.`));
    return backend;
  }
  if (row.limit === null) return backend;
  try {
    return clamped(parseQuotaValue(entry.kind, row.limit), backend);
  } catch (error) {
    input.skipped?.(row, error);
    return backend;
  }
}
