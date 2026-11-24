import type { ControlLease } from '@keelwerk/core';
import { expect, test } from 'vitest';
import type { LeaseHarness } from './lease-case-harness.ts';

/** The cases of the lease store's `renew`, inside the describe of the lease cases. */
export function leaseRenewCases(harness: LeaseHarness): void {
  const { run, read, hold, fresh, clock, ttlMs } = harness;
  const renew = (
    holder: string,
    leases: readonly {
      kind: ControlLease['kind'];
      key: string;
      units: number;
      scopeId?: string | null;
    }[],
  ) =>
    run((store) =>
      store.renew(
        holder,
        leases.map((lease) => ({ scopeId: null, ...lease })),
        ttlMs,
      ),
    );

  test("renew sets the units and the expiry of the holder's listed leases, answers each pair's total and whether the lease had lapsed, and leaves other holders' leases alone", async () => {
    const [k1, k2, k3] = [fresh(), fresh(), fresh()] as const;
    await hold('subscriptions', k1, 'p1', 2);
    await hold('subscriptions', k1, 'p2', 4);
    await hold('subscriptions', k2, 'p1', 1);
    await hold('subscriptions', k3, 'p2', 4);
    clock().advance(ttlMs / 2);
    expect(
      await renew('p1', [
        { kind: 'subscriptions', key: k3, units: 1 },
        { kind: 'subscriptions', key: k1, units: 1 },
      ]),
    ).toEqual([
      { total: 5, lapsed: true },
      { total: 5, lapsed: false },
    ]);
    clock().advance(ttlMs / 2 + 1_000);
    // p1's lease of k1 now counts 1 and lives on; p2's of k1 and k3 expired; k3 is held anew by p1; k2 expired unrenewed.
    expect(await read((store) => store.total('subscriptions', k1))).toBe(1);
    expect(await read((store) => store.total('subscriptions', k2))).toBe(0);
    expect(await read((store) => store.total('subscriptions', k3))).toBe(1);
  });

  test('renew deletes the lease of a pair with 0 units, and a lease that had lapsed or been swept is held anew at the units given', async () => {
    const [gone, lapsed, swept] = [fresh(), fresh(), fresh()] as const;
    const scope = crypto.randomUUID();
    await hold('invocations', swept, 'p1', 3, scope);
    clock().advance(ttlMs + 1);
    await run((store) => store.expire('invocations', 1_000));
    await hold('invocations', lapsed, 'p1', 3, scope);
    clock().advance(ttlMs + 1);
    await hold('invocations', gone, 'p1', 3, scope);
    expect(
      await renew('p1', [
        { kind: 'invocations', key: gone, units: 0, scopeId: scope },
        { kind: 'invocations', key: lapsed, units: 2, scopeId: scope },
        { kind: 'invocations', key: swept, units: 1, scopeId: scope },
      ]),
    ).toEqual([
      { total: 0, lapsed: false },
      { total: 2, lapsed: true },
      { total: 1, lapsed: true },
    ]);
    expect(await read((store) => store.total('invocations', gone))).toBe(0);
    expect(await read((store) => store.total('invocations', lapsed))).toBe(2);
    expect(await read((store) => store.total('invocations', swept))).toBe(1);
    // The scope id is stored: expiring the held-anew leases answers it.
    clock().advance(ttlMs + 1);
    const answered = await run((store) => store.expire('invocations', 1_000));
    expect(answered.map((pair) => pair.scopeId)).toEqual([scope, scope]);
  });

  test("renew deletes only the caller's lease of a pair listed at 0 units: another holder's lease of the pair still counts, in the answer and afterwards", async () => {
    const key = fresh();
    await hold('subscriptions', key, 'p1', 3);
    await hold('subscriptions', key, 'p2', 2);
    expect(await renew('p1', [{ kind: 'subscriptions', key, units: 0 }])).toEqual([
      { total: 2, lapsed: false },
    ]);
    expect(await read((store) => store.total('subscriptions', key))).toBe(2);
  });

  test("renew counts the other holders' unexpired leases in the total of each pair, in the order listed", async () => {
    const [k1, k2] = [fresh(), fresh()] as const;
    await hold('connections', k1, 'p2', 3);
    await hold('connections', k1, 'p3', 4);
    clock().advance(ttlMs + 1);
    await hold('connections', k1, 'p4', 5);
    await hold('connections', k2, 'p2', 2);
    expect(
      await renew('p1', [
        { kind: 'connections', key: k2, units: 1 },
        { kind: 'connections', key: k1, units: 6 },
        { kind: 'connections', key: fresh(), units: 7 },
      ]),
    ).toEqual([
      { total: 3, lapsed: true },
      { total: 11, lapsed: true },
      { total: 7, lapsed: true },
    ]);
  });

  test('renew of no pair answers none; a pair over 1,000, a pair twice, a bad part or units below 0 or fractional are validation, writing nothing; a read-only unit refuses it', async () => {
    const key = fresh();
    expect(await renew('p1', [])).toEqual([]);
    const refused = async (work: Promise<unknown>) => {
      await expect(work).rejects.toMatchObject({ kind: 'validation', code: 'core.validation' });
    };
    await refused(renew('p1', [{ kind: 'topic', key: 'a\u0000b', units: 1 }]));
    await refused(renew('p1', [{ kind: 'topic', key, units: -1 }]));
    await refused(renew('p1', [{ kind: 'topic', key, units: 1.5 }]));
    await refused(renew('p1', [{ kind: 'topic', key, units: 1, scopeId: 'not-a-uuid' }]));
    await refused(
      renew('p1', [
        { kind: 'topic', key, units: 1 },
        { kind: 'topic', key, units: 2 },
      ]),
    );
    const many = (count: number) =>
      Array.from({ length: count }, () => ({ kind: 'topic' as const, key: fresh(), units: 1 }));
    await refused(renew('p1', many(1_001)));
    await refused(
      run((store) => store.renew('p1', [{ kind: 'topic', scopeId: null, key, units: 1 }], 0)),
    );
    expect(await read((store) => store.total('topic', key))).toBe(0);
    expect(await renew('p1', many(1_000))).toHaveLength(1_000);
    await expect(
      read((store) => store.renew('p1', [{ kind: 'topic', scopeId: null, key, units: 1 }], ttlMs)),
    ).rejects.toMatchObject({ kind: 'internal' });
  });
}
