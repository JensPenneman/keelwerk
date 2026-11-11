import type { StorageScope } from '@keelwerk/core';
import { conformanceScopes } from '@keelwerk/data/conformance';
import { describe, expect, test } from 'vitest';
import type { ConformanceSubject } from './conformance-subject.ts';
import type { ConsumerKit } from './consumer-kit.ts';
import { failureOf } from './failure-of.ts';

const { tenantA, tenantB, tenantC } = conformanceScopes;
const scopeA = tenantA.tenantId;
const scopeB = tenantB.tenantId;
const scopeC = tenantC.tenantId;
const inNamespace: StorageScope = { level: 'namespace', reason: 'conformance' };
const consumer = 'consumer.one';
const other = 'consumer.two';

/** The start of a `start: 'now'` consumer (15.2.3): one start record and one snapshot of the heads. */
export function consumerStartCases(
  kit: ConsumerKit,
  subject: Pick<ConformanceSubject, 'read'>,
): void {
  const { inA, inNs, checkpointOf, headOf, append } = kit;
  describe('a consumer that starts now (15.2.3)', () => {
    const heads = async (name: string): Promise<(bigint | null)[]> => [
      await checkpointOf(name, scopeA),
      await checkpointOf(name, scopeB),
      await checkpointOf(name, scopeC),
    ];

    test('a start checkpoints every scope that has events at its head, once', async () => {
      await append(tenantA, 3);
      await append(tenantB, 2);
      expect(await inNs((unit) => unit.consumers.startAtHeads(consumer))).toBe(true);
      expect(await heads(consumer)).toEqual([
        await headOf(tenantA),
        await headOf(tenantB),
        await headOf(tenantC),
      ]);
      expect(await heads(consumer)).toEqual([3n, 2n, null]);
      await append(tenantA, 4);
      expect(await inNs((unit) => unit.consumers.startAtHeads(consumer))).toBe(false);
      expect(await heads(consumer)).toEqual([3n, 2n, null]);
      expect(await heads(other)).toEqual([null, null, null]);
    });

    test('a start never moves an existing checkpoint', async () => {
      await append(tenantA, 5);
      await append(tenantB, 5);
      await inA((unit) => unit.consumers.advance(consumer, scopeA, 1n));
      expect(await inNs((unit) => unit.consumers.startAtHeads(consumer))).toBe(true);
      expect(await heads(consumer)).toEqual([1n, 5n, null]);
    });

    test('a start in a namespace without events still records the start', async () => {
      expect(await inNs((unit) => unit.consumers.startAtHeads(consumer))).toBe(true);
      expect(await heads(consumer)).toEqual([null, null, null]);
      await append(tenantA, 2);
      expect(await inNs((unit) => unit.consumers.startAtHeads(consumer))).toBe(false);
      expect(await heads(consumer)).toEqual([null, null, null]);
    });

    test('a start is refused outside namespace-scope units and in read-only units', async () => {
      expect(await failureOf(inA((unit) => unit.consumers.startAtHeads(consumer)))).toEqual({
        kind: 'forbidden',
        code: 'core.forbidden',
      });
      expect(
        await failureOf(subject.read(inNamespace, (unit) => unit.consumers.startAtHeads(consumer))),
      ).toEqual({ kind: 'internal', code: 'core.internal' });
      expect(await inNs((unit) => unit.consumers.startAtHeads(consumer))).toBe(true);
    });

    test('a start in a rolled-back unit records nothing', async () => {
      await append(tenantA, 3);
      await inNs(async (unit) => {
        expect(await unit.consumers.startAtHeads(consumer)).toBe(true);
        throw new Error('boom');
      }).catch(() => undefined);
      expect(await heads(consumer)).toEqual([null, null, null]);
      await inNs(async (unit) => {
        await unit
          .nested(async (inner) => {
            await inner.consumers.startAtHeads(consumer);
            throw new Error('boom');
          })
          .catch(() => undefined);
      });
      expect(await heads(consumer)).toEqual([null, null, null]);
      expect(await inNs((unit) => unit.consumers.startAtHeads(consumer))).toBe(true);
      expect(await heads(consumer)).toEqual([3n, null, null]);
    });

    test('the start record is no scope: its id is refused and no read lists it', async () => {
      const reserved = '00000000-0000-0000-0000-000000000000';
      const invalid = { kind: 'validation', code: 'core.validation' };
      expect(await inNs((unit) => unit.consumers.startAtHeads(consumer))).toBe(true);
      expect(
        await failureOf(inNs((unit) => unit.consumers.checkpoint(consumer, reserved))),
      ).toEqual(invalid);
      expect(
        await failureOf(inA((unit) => unit.consumers.advance(consumer, reserved, 0n))),
      ).toEqual(invalid);
      expect(await inNs((unit) => unit.consumers.parked(consumer))).toEqual([]);
      expect(await inA((unit) => unit.consumers.parked(consumer))).toEqual([]);
    });
  });
}
