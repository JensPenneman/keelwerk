import { describe, expect, test } from 'vitest';
import type { Clock } from '../kernel/clock.ts';
import type { Logger } from '../observability/logger.ts';
import type { ControlStore } from './control-store.ts';
import { createRestoreHold } from './create-restore-hold.ts';
import { RestoreHoldRefusal } from './restore-hold-refusal.ts';

const tenant = '0192f3a0-0000-7000-8000-000000000001';
const other = '0192f3a0-0000-7000-8000-000000000002';

function setup(unfinished: () => number) {
  const logged: { readonly message: string; readonly fields: unknown }[] = [];
  const warned: { readonly message: string; readonly fields: unknown }[] = [];
  const log = {
    error: (message: string, fields: unknown) => logged.push({ message, fields }),
    warn: (message: string, fields: unknown) => warned.push({ message, fields }),
  } as unknown as Logger;
  let ms = Date.parse('2026-11-17T10:00:00Z');
  const clock: Clock = { now: () => Temporal.Instant.fromEpochMilliseconds(ms) };
  const reads: unknown[] = [];
  const control = {
    epochs: () => new Map(),
    ledger: {
      unfinished: async (query: { tenantIds?: readonly string[] }) => {
        reads.push(query.tenantIds);
        const count = unfinished();
        return {
          erasures: Array.from({ length: count }, (_, seq) => ({ seq: BigInt(seq + 1) })),
          head: 0n,
        };
      },
    },
  } as unknown as ControlStore;
  return {
    reads,
    logged,
    warned,
    advance: (by: number) => {
      ms += by;
    },
    hold: createRestoreHold(control, clock, [tenant], log),
  };
}

describe('the restore hold', () => {
  test('a held tenant is refused with core.unavailable and the ledger is asked for that tenant', async () => {
    const { hold, reads } = setup(() => 1);
    await expect(hold.check(tenant)).rejects.toMatchObject({
      kind: 'unavailable',
      code: 'core.unavailable',
    });
    expect(reads).toEqual([[tenant]]);
    expect([...hold.held()]).toEqual([tenant]);
  });

  test('the refusal tells the caller to try again after a second, and a job is told apart by its class', async () => {
    const { hold } = setup(() => 1);
    const refusal = await hold.check(tenant).catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(RestoreHoldRefusal);
    expect(refusal).toMatchObject({ kind: 'unavailable', retryable: true, retryAfter: 1 });
  });

  test('the ledger is read at most once a second of the clock', async () => {
    const { hold, reads, advance } = setup(() => 1);
    await expect(hold.check(tenant)).rejects.toBeDefined();
    await expect(hold.check(tenant)).rejects.toBeDefined();
    await expect(Promise.all([hold.check(tenant), hold.check(tenant)])).rejects.toBeDefined();
    expect(reads).toHaveLength(1);
    advance(1000);
    await expect(hold.check(tenant)).rejects.toBeDefined();
    expect(reads).toHaveLength(2);
  });

  test('a request that comes while a read is in flight waits for it and sees the lifted hold', async () => {
    const { hold, reads } = setup(() => 0);
    // The second request arrives after the read began and before it answered.
    await Promise.all([hold.check(tenant), hold.check(tenant)]);
    expect(reads).toEqual([[tenant]]);
    expect([...hold.held()]).toEqual([]);
  });

  test('the hold lifts once no unfinished erasure is left', async () => {
    let left = 1;
    const { hold, advance, warned } = setup(() => left);
    await expect(hold.check(tenant)).rejects.toBeDefined();
    expect(warned).toEqual([]);
    left = 0;
    advance(1000);
    await expect(hold.check(tenant)).resolves.toBeUndefined();
    expect(hold.held().size).toBe(0);
    // The end of a hold is logged at warn, with the tenant id only.
    expect(warned).toEqual([
      { message: 'a tenant is served again: its erasures have run', fields: { tenantId: tenant } },
    ]);
  });

  test('a failing read keeps the tenant held with core.unavailable, is read once a second and logged once', async () => {
    let failing = true;
    const { hold, reads, logged, advance } = setup(() => {
      if (failing) throw new Error('the ledger is down');
      return 0;
    });
    await expect(hold.check(tenant)).rejects.toMatchObject({ code: 'core.unavailable' });
    await expect(hold.check(tenant)).rejects.toMatchObject({ code: 'core.unavailable' });
    expect(reads).toHaveLength(1);
    advance(1000);
    await expect(hold.check(tenant)).rejects.toMatchObject({ code: 'core.unavailable' });
    expect(reads).toHaveLength(2);
    expect(logged).toHaveLength(1);
    expect(JSON.stringify(logged[0]?.fields)).toContain(tenant);
    failing = false;
    advance(1000);
    await expect(hold.check(tenant)).resolves.toBeUndefined();
    expect([...hold.held()]).toEqual([]);
  });

  test('a tenant that is not held passes without a read', async () => {
    const { hold, reads } = setup(() => 1);
    await expect(hold.check(other)).resolves.toBeUndefined();
    expect(reads).toEqual([]);
  });
});
