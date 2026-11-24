import type { ControlLease, ControlLeaseStore } from '@keelwerk/core';
import { beforeEach, describe, expect, test } from 'vitest';
import type { ConformanceSubject } from './conformance-subject.ts';
import { leaseHarness } from './lease-case-harness.ts';
import { leaseRenewCases } from './lease-renew-cases.ts';

/** The lease store (S-120), in the control namespace of the subject (see `leaseHarness`). */
export function leaseCases(subject: ConformanceSubject): void {
  describe('leases (S-120)', () => {
    const harness = leaseHarness(subject);
    const { run, read, hold, fresh, clock, ttlMs } = harness;

    beforeEach(harness.reset);

    leaseRenewCases(harness);

    test('hold answers the units of every unexpired lease of the kind and key, its own included', async () => {
      const key = fresh();
      expect(await hold('topic', key, 'p1', 2)).toEqual({ total: 2 });
      expect(await hold('topic', key, 'p2', 3)).toEqual({ total: 5 });
      expect(await read((leases) => leases.total('topic', key))).toBe(5);
    });

    test('a second hold of one holder replaces its units and renews its expiry', async () => {
      const key = fresh();
      expect(await hold('topic', key, 'p1', 2)).toEqual({ total: 2 });
      clock().advance(6_000);
      expect(await hold('topic', key, 'p1', 5)).toEqual({ total: 5 });
      clock().advance(6_000);
      expect(await read((leases) => leases.total('topic', key))).toBe(5);
    });

    test('two leases of one kind and key with different scope ids and holders sum into one total', async () => {
      const key = fresh();
      await hold('topic', key, 'p1', 1, crypto.randomUUID());
      expect(await hold('topic', key, 'p2', 4, crypto.randomUUID())).toEqual({ total: 5 });
      expect(await read((leases) => leases.total('topic', key))).toBe(5);
    });

    test('another kind or another key is another count', async () => {
      const key = fresh();
      await hold('topic', key, 'p1', 2);
      expect(await hold('connections', key, 'p1', 3)).toEqual({ total: 3 });
      expect(await hold('topic', fresh(), 'p1', 7)).toEqual({ total: 7 });
      expect(await read((leases) => leases.total('topic', key))).toBe(2);
    });

    test('an expired lease counts 0 and a hold after it starts the count again', async () => {
      const key = fresh();
      await hold('topic', key, 'p1', 2);
      clock().advance(ttlMs + 1);
      expect(await read((leases) => leases.total('topic', key))).toBe(0);
      expect(await hold('topic', key, 'p2', 1)).toEqual({ total: 1 });
    });

    test("release deletes only that holder's lease; releasing a lease that is not there is no error", async () => {
      const key = fresh();
      await hold('topic', key, 'p1', 2);
      await hold('topic', key, 'p2', 3);
      await run((leases) => leases.release('topic', key, 'p1'));
      expect(await read((leases) => leases.total('topic', key))).toBe(3);
      await run((leases) => leases.release('topic', key, 'p1'));
      await run((leases) => leases.release('topic', fresh(), 'p9'));
      expect(await read((leases) => leases.total('topic', key))).toBe(3);
    });

    test('two concurrent first holds of one key never both answer only their own units', async () => {
      for (let round = 0; round < 5; round += 1) {
        const key = fresh();
        const [a, b] = await Promise.all([
          hold('topic', key, 'p1', 1),
          hold('topic', key, 'p2', 1),
        ]);
        expect(Math.max(a.total, b.total)).toBe(2);
      }
    });

    test('expire deletes up to the limit, oldest first, and answers each pair with no unexpired lease left, with its scope id', async () => {
      const [k1, k2, k3] = [fresh(), fresh(), fresh()] as const;
      const scope = crypto.randomUUID();
      await hold('subscriptions', k1, 'p1', 1, scope);
      clock().advance(1_000);
      await hold('subscriptions', k2, 'p1', 1, null);
      clock().advance(1_000);
      await hold('subscriptions', k3, 'p1', 1, scope);
      clock().advance(ttlMs + 5_000);
      const first = await run((leases) => leases.expire('subscriptions', 2));
      expect([...first].sort((a, b) => a.key.localeCompare(b.key))).toEqual(
        [
          { scopeId: scope, key: k1 },
          { scopeId: null, key: k2 },
        ].sort((a, b) => a.key.localeCompare(b.key)),
      );
      expect(await run((leases) => leases.expire('subscriptions', 2))).toEqual([
        { scopeId: scope, key: k3 },
      ]);
      expect(await run((leases) => leases.expire('subscriptions', 2))).toEqual([]);
    });

    test('a pair that still has an unexpired lease is not answered by expire', async () => {
      const key = fresh();
      await hold('invocations', key, 'p1', 1);
      clock().advance(ttlMs - 1_000);
      await hold('invocations', key, 'p2', 1);
      clock().advance(2_000);
      expect(await run((leases) => leases.expire('invocations', 10))).toEqual([]);
      expect(await read((leases) => leases.total('invocations', key))).toBe(1);
    });

    test('two concurrent expire calls answer every expired pair once between them', async () => {
      const keys = Array.from({ length: 6 }, fresh);
      for (const key of keys) await hold('connections', key, 'p1', 1);
      clock().advance(ttlMs + 1);
      const [a, b] = await Promise.all([
        run((leases) => leases.expire('connections', 1_000)),
        run((leases) => leases.expire('connections', 1_000)),
      ]);
      const answered = [...a, ...b].map((pair) => pair.key).sort();
      expect(answered).toEqual([...keys].sort());
    });

    test('a non-UUID or upper-case scope id, units or ttl below 1 or fractional, a key or holder with U+0000, a key over 2,000 bytes and a limit of 0 or 1,001 are validation', async () => {
      const lease = { kind: 'topic', scopeId: null, key: fresh(), holder: 'p1', units: 1 } as const;
      const refused = async (work: Promise<unknown>) => {
        await expect(work).rejects.toMatchObject({ kind: 'validation', code: 'core.validation' });
      };
      await refused(run((l) => l.hold({ ...lease, scopeId: 'not-a-uuid' }, ttlMs)));
      await refused(
        run((l) => l.hold({ ...lease, scopeId: crypto.randomUUID().toUpperCase() }, ttlMs)),
      );
      await refused(run((l) => l.hold({ ...lease, units: 0 }, ttlMs)));
      await refused(run((l) => l.hold({ ...lease, units: 1.5 }, ttlMs)));
      await refused(run((l) => l.hold(lease, 0)));
      await refused(run((l) => l.hold(lease, 1.5)));
      await refused(run((l) => l.hold({ ...lease, key: 'a\u0000b' }, ttlMs)));
      await refused(run((l) => l.hold({ ...lease, holder: 'a\u0000b' }, ttlMs)));
      await refused(run((l) => l.hold({ ...lease, key: '' }, ttlMs)));
      await refused(run((l) => l.hold({ ...lease, key: 'a'.repeat(2_001) }, ttlMs)));
      await refused(run((l) => l.release('topic', 'a'.repeat(2_001), 'p1')));
      await refused(read((l) => l.total('topic', 'a\u0000b')));
      await refused(run((l) => l.expire('topic', 0)));
      await refused(run((l) => l.expire('topic', 1_001)));
      await refused(run((l) => l.expire('bogus' as ControlLease['kind'], 10)));
    });

    test('a time-to-live above 2,147,483,647 milliseconds is validation and writes no row; 2,147,483,647 is accepted and counted', async () => {
      const key = fresh();
      const lease = { kind: 'topic', scopeId: null, key, holder: 'p1', units: 1 } as const;
      for (const tooLong of [2_147_483_648, 3e14, 9e15]) {
        await expect(run((l) => l.hold(lease, tooLong))).rejects.toMatchObject({
          kind: 'validation',
          code: 'core.validation',
        });
        expect(await read((l) => l.total('topic', key))).toBe(0);
      }
      expect(await run((l) => l.hold(lease, 2_147_483_647))).toEqual({ total: 1 });
      expect(await read((l) => l.total('topic', key))).toBe(1);
      await run((l) => l.release('topic', key, 'p1'));
      expect(await read((l) => l.total('topic', key))).toBe(0);
    });

    test('a key or holder with a lone surrogate is validation, so two such keys never become one stored key', async () => {
      const lease = { kind: 'topic', scopeId: null, key: fresh(), holder: 'p1', units: 1 } as const;
      const refused = async (work: Promise<unknown>) => {
        await expect(work).rejects.toMatchObject({ kind: 'validation', code: 'core.validation' });
      };
      await refused(run((l) => l.hold({ ...lease, key: 'k\uD800' }, ttlMs)));
      await refused(run((l) => l.hold({ ...lease, key: 'k\uDBFF' }, ttlMs)));
      await refused(run((l) => l.hold({ ...lease, holder: 'p\uD800' }, ttlMs)));
      await refused(run((l) => l.release('topic', 'k\uD800', 'p1')));
      await refused(read((l) => l.total('topic', 'k\uDC00')));
      expect(await hold('topic', 'k\u{1F600}', 'p1', 1)).toMatchObject({ total: 1 });
    });

    test('total reads in a read-only unit; hold, release and expire refuse one', async () => {
      const key = fresh();
      await hold('topic', key, 'p1', 2);
      const refusedWrite = (work: (leases: ControlLeaseStore) => Promise<unknown>) =>
        expect(read(work)).rejects.toMatchObject({ kind: 'internal' });
      expect(await read((leases) => leases.total('topic', key))).toBe(2);
      await refusedWrite((leases) =>
        leases.hold({ kind: 'topic', scopeId: null, key, holder: 'p2', units: 1 }, ttlMs),
      );
      await refusedWrite((leases) => leases.release('topic', key, 'p1'));
      await refusedWrite((leases) => leases.expire('topic', 10));
    });
  });
}
