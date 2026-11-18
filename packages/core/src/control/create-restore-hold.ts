import type { Clock } from '../kernel/clock.ts';
import type { Logger } from '../observability/logger.ts';
import type { ControlStore } from './control-store.ts';
import type { RestoreHold } from './restore-hold.ts';
import { RestoreHoldRefusal } from './restore-hold-refusal.ts';

/** How often a held tenant's erasures are read again, in milliseconds of the runtime clock. */
const rereadMs = 1000;

/**
 * The hold of the tenants that have an erasure left to run at the start (14.7.6): one a restore
 * made run again, or one still pending. A tenant is held from the start until
 * `control.ledger.unfinished` answers no erasure for it; the check reads the ledger at most once a
 * second of the clock and shares one read between the requests of a tenant. A read that fails
 * keeps the tenant held and refuses with the retryable `core.unavailable`; the second of the clock
 * counts from the attempt, so an outage is not read again by every request, and the cause is
 * logged once per outage (tenant id only); the end of a hold is logged at warn (tenant id only),
 * as its start is. The refusal is a `RestoreHoldRefusal`, which carries `retryAfter`. A tenant
 * that is not held passes without a read.
 */
export function createRestoreHold(
  control: ControlStore,
  clock: Clock,
  tenantIds: Iterable<string>,
  log: Logger,
): RestoreHold {
  const held = new Set(tenantIds);
  const readAt = new Map<string, number>();
  const reading = new Map<string, Promise<void>>();
  const failing = new Set<string>();
  const read = async (tenantId: string): Promise<void> => {
    readAt.set(tenantId, clock.now().epochMilliseconds);
    try {
      const { erasures } = await control.ledger.unfinished({
        epochs: control.epochs(),
        after: 0n,
        limit: 1,
        tenantIds: [tenantId],
      });
      failing.delete(tenantId);
      if (erasures.length === 0) {
        held.delete(tenantId);
        log.warn('a tenant is served again: its erasures have run', { tenantId });
      }
    } catch (cause) {
      if (!failing.has(tenantId)) {
        failing.add(tenantId);
        log.error('the erasures of a held tenant could not be read; the tenant stays held', {
          tenantId,
          cause,
        });
      }
    }
  };
  return {
    held: () => held,
    check: async (tenantId) => {
      if (!held.has(tenantId)) return;
      const last = readAt.get(tenantId);
      if (last === undefined || clock.now().epochMilliseconds - last >= rereadMs) {
        let running = reading.get(tenantId);
        if (running === undefined) {
          running = read(tenantId).finally(() => reading.delete(tenantId));
          reading.set(tenantId, running);
        }
        await running;
      }
      if (held.has(tenantId)) {
        throw new RestoreHoldRefusal();
      }
    },
  };
}
