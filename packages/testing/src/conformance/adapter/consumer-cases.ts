import type { StorageScope, StreamRef, WireError } from '@keelwerk/core';
import { conformanceId, conformanceScopes } from '@keelwerk/data/conformance';
import { describe, expect, test } from 'vitest';
import type { ConformanceSubject } from './conformance-subject.ts';
import { consumerCheckCases } from './consumer-check-cases.ts';
import { consumerKit } from './consumer-kit.ts';
import { consumerParkedCases } from './consumer-parked-cases.ts';
import { consumerStartCases } from './consumer-start-cases.ts';
import { failureOf } from './failure-of.ts';

const { tenantA, tenantB, tenantC } = conformanceScopes;
const scopeA = tenantA.tenantId;
const scopeB = tenantB.tenantId;
const _scopeC = tenantC.tenantId;
const _inNamespace: StorageScope = { level: 'namespace', reason: 'conformance' };
const consumer = 'consumer.one';
const other = 'consumer.two';
const leaseMs = 60_000;

const streamOf = (n: number): StreamRef => ({ type: 'library.book', id: conformanceId(n) });
const errorOf = (code: string, message = 'a personal value: ada@example.org'): WireError => ({
  kind: 'internal',
  code,
  message,
  retryable: false,
  requestId: 'request-1',
});

/**
 * The consumer store of every adapter (15.2.3, 14.3.2): checkpoints that never move back (S-173),
 * leases that live in the namespace, and parked streams that count their parkings.
 */
export function consumerCases(subject: Pick<ConformanceSubject, 'run' | 'read' | 'clock'>): void {
  const kit = consumerKit(subject);
  const { clock, inA, inB, inNs, checkpointOf, seed } = kit;

  describe('consumers (15.2.3, 14.10 case 10)', () => {
    test('a checkpoint is null until the first advance and reads back per consumer and scope', async () => {
      await seed();
      expect(await checkpointOf(consumer, scopeA)).toBeNull();
      await inA((unit) => unit.consumers.advance(consumer, scopeA, 7n));
      await inB((unit) => unit.consumers.advance(consumer, scopeB, 3n));
      await inA((unit) => unit.consumers.advance(other, scopeA, 0n));
      expect(await checkpointOf(consumer, scopeA)).toBe(7n);
      expect(await checkpointOf(consumer, scopeB)).toBe(3n);
      expect(await checkpointOf(other, scopeA)).toBe(0n);
      expect(await checkpointOf(other, scopeB)).toBeNull();
    });

    test('advance never moves a checkpoint back (S-173)', async () => {
      await seed();
      await inA((unit) => unit.consumers.advance(consumer, scopeA, 10n));
      await inA((unit) => unit.consumers.advance(consumer, scopeA, 5n));
      expect(await checkpointOf(consumer, scopeA)).toBe(10n);
      await inA((unit) => unit.consumers.advance(consumer, scopeA, 10n));
      await inA((unit) => unit.consumers.advance(consumer, scopeA, 15n));
      expect(await checkpointOf(consumer, scopeA)).toBe(15n);
    });

    test('a stale holder advancing after the new holder advanced further leaves the new position (S-173)', async () => {
      await seed();
      expect(await inNs((unit) => unit.consumers.acquireLease(consumer, 'holder-a', 1000))).toBe(
        true,
      );
      clock().advance(1001);
      expect(await inNs((unit) => unit.consumers.acquireLease(consumer, 'holder-b', 1000))).toBe(
        true,
      );
      expect(await inNs((unit) => unit.consumers.renewLease(consumer, 'holder-a', 1000))).toBe(
        false,
      );
      await inA((unit) => unit.consumers.advance(consumer, scopeA, 20n));
      await inA((unit) => unit.consumers.advance(consumer, scopeA, 10n));
      expect(await checkpointOf(consumer, scopeA)).toBe(20n);
    });

    test('a checkpoint advanced in a rolled-back unit or savepoint does not move', async () => {
      await seed();
      await inA((unit) => unit.consumers.advance(consumer, scopeA, 4n));
      await inA(async (unit) => {
        await unit.consumers.advance(consumer, scopeA, 9n);
        throw new Error('boom');
      }).catch(() => undefined);
      expect(await checkpointOf(consumer, scopeA)).toBe(4n);
      await inA(async (unit) => {
        await unit
          .nested(async (inner) => {
            await inner.consumers.advance(consumer, scopeA, 8n);
            throw new Error('boom');
          })
          .catch(() => undefined);
        await unit.consumers.advance(consumer, scopeA, 6n);
      });
      expect(await checkpointOf(consumer, scopeA)).toBe(6n);
    });

    test("a tenant unit reaches only its own checkpoint; a namespace unit reads every scope's", async () => {
      await seed();
      await inA((unit) => unit.consumers.advance(consumer, scopeA, 2n));
      await inB((unit) => unit.consumers.advance(consumer, scopeB, 3n));
      expect(await inA((unit) => unit.consumers.checkpoint(consumer, scopeA))).toBe(2n);
      expect(
        await subject.read(tenantB, (unit) => unit.consumers.checkpoint(consumer, scopeB)),
      ).toBe(3n);
      expect(await failureOf(inA((unit) => unit.consumers.checkpoint(consumer, scopeB)))).toEqual({
        kind: 'forbidden',
        code: 'core.forbidden',
      });
      expect(await checkpointOf(consumer, scopeA)).toBe(2n);
      expect(await checkpointOf(consumer, scopeB)).toBe(3n);
    });

    test('a lease is held by one owner until it expires, then another acquires it', async () => {
      expect(await inNs((unit) => unit.consumers.acquireLease(consumer, 'one', leaseMs))).toBe(
        true,
      );
      expect(await inNs((unit) => unit.consumers.acquireLease(consumer, 'one', leaseMs))).toBe(
        true,
      );
      expect(await inNs((unit) => unit.consumers.acquireLease(consumer, 'two', leaseMs))).toBe(
        false,
      );
      expect(await inNs((unit) => unit.consumers.acquireLease(other, 'two', leaseMs))).toBe(true);
      clock().advance(leaseMs + 1);
      expect(await inNs((unit) => unit.consumers.acquireLease(consumer, 'two', leaseMs))).toBe(
        true,
      );
      expect(await inNs((unit) => unit.consumers.renewLease(consumer, 'one', leaseMs))).toBe(false);
      expect(await inNs((unit) => unit.consumers.renewLease(consumer, 'two', leaseMs))).toBe(true);
    });

    test('renewing with ttl 0 hands the lease over at once; renewing an expired lease fails', async () => {
      expect(await inNs((unit) => unit.consumers.acquireLease(consumer, 'one', leaseMs))).toBe(
        true,
      );
      expect(await inNs((unit) => unit.consumers.renewLease(consumer, 'one', 0))).toBe(true);
      expect(await inNs((unit) => unit.consumers.renewLease(consumer, 'one', leaseMs))).toBe(false);
      expect(await inNs((unit) => unit.consumers.acquireLease(consumer, 'two', leaseMs))).toBe(
        true,
      );
      clock().advance(leaseMs + 1);
      expect(await inNs((unit) => unit.consumers.renewLease(consumer, 'two', leaseMs))).toBe(false);
      expect(await inNs((unit) => unit.consumers.renewLease(consumer, 'nobody', leaseMs))).toBe(
        false,
      );
    });

    test('leases are refused outside namespace-scope units, and advance, park and unpark inside them', async () => {
      const forbidden = { kind: 'forbidden', code: 'core.forbidden' };
      expect(
        await failureOf(inA((unit) => unit.consumers.acquireLease(consumer, 'one', leaseMs))),
      ).toEqual(forbidden);
      expect(
        await failureOf(inA((unit) => unit.consumers.renewLease(consumer, 'one', leaseMs))),
      ).toEqual(forbidden);
      expect(await failureOf(inNs((unit) => unit.consumers.advance(consumer, scopeA, 1n)))).toEqual(
        forbidden,
      );
      expect(
        await failureOf(
          inNs((unit) => unit.consumers.park(consumer, streamOf(1), 1n, errorOf('core.internal'))),
        ),
      ).toEqual(forbidden);
      expect(await failureOf(inNs((unit) => unit.consumers.unpark(consumer, streamOf(1))))).toEqual(
        forbidden,
      );
      expect(await failureOf(inA((unit) => unit.consumers.advance(consumer, scopeB, 1n)))).toEqual(
        forbidden,
      );
      const invalid = { kind: 'validation', code: 'core.validation' };
      expect(await failureOf(inA((unit) => unit.consumers.advance(consumer, scopeA, -1n)))).toEqual(
        invalid,
      );
      for (const ttl of [0, -5, 1.5, Number.NaN]) {
        expect(
          await failureOf(inNs((unit) => unit.consumers.acquireLease(consumer, 'one', ttl))),
        ).toEqual(invalid);
      }
      for (const ttl of [-1, 0.5]) {
        expect(
          await failureOf(inNs((unit) => unit.consumers.renewLease(consumer, 'one', ttl))),
        ).toEqual(invalid);
      }
      expect(
        await failureOf(
          inA((unit) =>
            unit.consumers.park(consumer, streamOf(1), 1n, errorOf('free text, no code')),
          ),
        ),
      ).toEqual(invalid);
      expect(
        await failureOf(
          subject.read(tenantA, (unit) => unit.consumers.advance(consumer, scopeA, 1n)),
        ),
      ).toEqual({ kind: 'internal', code: 'core.internal' });
    });

    test('park records the stream at its position; unpark answers it once and removes it', async () => {
      const before = clock().now().epochMilliseconds;
      await inA((unit) =>
        unit.consumers.park(consumer, streamOf(1), 12n, errorOf('core.internal')),
      );
      const [row, ...rest] = await inA((unit) => unit.consumers.parked(consumer));
      expect(rest).toEqual([]);
      expect(row).toMatchObject({
        scopeId: scopeA,
        stream: streamOf(1),
        from: 12n,
        attempts: 1,
        lastError: { kind: 'internal', code: 'core.internal' },
      });
      expect(row?.parkedAt.epochMilliseconds).toBeGreaterThanOrEqual(before);
      expect(row?.parkedAt.epochMilliseconds).toBeLessThanOrEqual(clock().now().epochMilliseconds);
      expect(await inA((unit) => unit.consumers.parked(other))).toEqual([]);
      expect(await inA((unit) => unit.consumers.unpark(consumer, streamOf(1)))).toBe(12n);
      expect(await inA((unit) => unit.consumers.unpark(consumer, streamOf(1)))).toBeNull();
      expect(await inA((unit) => unit.consumers.parked(consumer))).toEqual([]);
    });

    test('a parked stream keeps the kind and code of its error and never its message', async () => {
      await inA((unit) =>
        unit.consumers.park(consumer, streamOf(1), 3n, errorOf('core.internal', 'ada@example.org')),
      );
      const [row] = await inA((unit) => unit.consumers.parked(consumer));
      expect(JSON.stringify(row?.lastError)).not.toContain('ada@example.org');
      expect(row?.lastError.kind).toBe('internal');
      expect(row?.lastError.code).toBe('core.internal');
    });

    test('parking a parked stream again keeps the earliest position, counts the parkings and keeps parked_at', async () => {
      await inA((unit) =>
        unit.consumers.park(consumer, streamOf(1), 10n, errorOf('core.internal')),
      );
      const parkedAt = (await inA((unit) => unit.consumers.parked(consumer)))[0]?.parkedAt;
      clock().advance(500);
      await inA((unit) =>
        unit.consumers.park(consumer, streamOf(1), 20n, errorOf('core.timeout_x')),
      );
      let [row] = await inA((unit) => unit.consumers.parked(consumer));
      expect(row).toMatchObject({
        from: 10n,
        attempts: 2,
        lastError: { code: 'core.internal' },
      });
      expect(row?.parkedAt.epochMilliseconds).toBe(parkedAt?.epochMilliseconds);
      clock().advance(500);
      await inA((unit) =>
        unit.consumers.park(consumer, streamOf(1), 4n, errorOf('core.timeout_x')),
      );
      [row] = await inA((unit) => unit.consumers.parked(consumer));
      expect(row).toMatchObject({ from: 4n, attempts: 3, lastError: { code: 'core.timeout_x' } });
      expect(row?.parkedAt.epochMilliseconds).toBe(parkedAt?.epochMilliseconds);
      await inA((unit) => unit.consumers.unpark(consumer, streamOf(1)));
      await inA((unit) => unit.consumers.park(consumer, streamOf(1), 9n, errorOf('core.internal')));
      [row] = await inA((unit) => unit.consumers.parked(consumer));
      expect(row).toMatchObject({ from: 9n, attempts: 1 });
    });

    test("parked streams belong to their scope; a namespace unit lists every scope's", async () => {
      await inB((unit) => unit.consumers.park(consumer, streamOf(2), 5n, errorOf('core.internal')));
      await inA((unit) => unit.consumers.park(consumer, streamOf(3), 9n, errorOf('core.internal')));
      await inA((unit) => unit.consumers.park(consumer, streamOf(2), 9n, errorOf('core.internal')));
      await inA((unit) => unit.consumers.park(consumer, streamOf(1), 2n, errorOf('core.internal')));
      await inA((unit) => unit.consumers.park(other, streamOf(1), 1n, errorOf('core.internal')));
      const own = await inA((unit) => unit.consumers.parked(consumer));
      expect(own.map((row) => [row.scopeId, row.from, row.stream.id])).toEqual([
        [scopeA, 2n, streamOf(1).id],
        [scopeA, 9n, streamOf(2).id],
        [scopeA, 9n, streamOf(3).id],
      ]);
      expect(await inA((unit) => unit.consumers.unpark(consumer, streamOf(2)))).toBe(9n);
      expect(await inB((unit) => unit.consumers.unpark(consumer, streamOf(1)))).toBeNull();
      const all = await inNs((unit) => unit.consumers.parked(consumer));
      expect(all.map((row) => [row.scopeId, row.stream.id])).toEqual([
        [scopeA, streamOf(1).id],
        [scopeA, streamOf(3).id],
        [scopeB, streamOf(2).id],
      ]);
    });

    test('a park in a rolled-back unit leaves nothing parked', async () => {
      await inA(async (unit) => {
        await unit.consumers.park(consumer, streamOf(1), 3n, errorOf('core.internal'));
        throw new Error('boom');
      }).catch(() => undefined);
      expect(await inNs((unit) => unit.consumers.parked(consumer))).toEqual([]);
      await inA(async (unit) => {
        await unit
          .nested(async (inner) => {
            await inner.consumers.park(consumer, streamOf(1), 3n, errorOf('core.internal'));
            throw new Error('boom');
          })
          .catch(() => undefined);
        await unit.consumers.park(consumer, streamOf(2), 4n, errorOf('core.internal'));
      });
      const left = await inNs((unit) => unit.consumers.parked(consumer));
      expect(left.map((row) => row.stream.id)).toEqual([streamOf(2).id]);
    });

    consumerCheckCases(kit);
    consumerParkedCases(kit, subject);
    consumerStartCases(kit, subject);
  });
}
