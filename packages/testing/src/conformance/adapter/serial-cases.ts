import { conformanceEntities, conformanceScopes } from '@keelwerk/data/conformance';
import { describe, expect, test } from 'vitest';
import type { ConformanceSubject } from './conformance-subject.ts';
import { failureOf } from './failure-of.ts';

const { ticket, owner } = conformanceEntities;
const { tenantA } = conformanceScopes;

export function serialCases(subject: ConformanceSubject): void {
  describe('serials (15.1.4, 14.10 case 7)', () => {
    test('values start at 1 and rise by the count taken, per partition', async () => {
      const taken = await subject.run(tenantA, async (unit) => [
        await unit.serials.next(ticket, 'seq', ['a']),
        await unit.serials.next(ticket, 'seq', ['a'], 3),
        await unit.serials.next(ticket, 'seq', ['a']),
        await unit.serials.next(ticket, 'seq', ['b']),
      ]);
      expect(taken).toEqual([1n, 2n, 5n, 1n]);
    });

    test('values are never reused: a rolled-back unit gives its values back before anyone saw them', async () => {
      await subject.run(tenantA, (unit) => unit.serials.next(ticket, 'seq', ['a']));
      await subject
        .run(tenantA, async (unit) => {
          await unit.serials.next(ticket, 'seq', ['a'], 5);
          throw new Error('boom');
        })
        .catch(() => undefined);
      expect(await subject.run(tenantA, (unit) => unit.serials.next(ticket, 'seq', ['a']))).toBe(
        2n,
      );
    });

    test('concurrent units get distinct values that ascend in commit order', async () => {
      const committed: bigint[] = [];
      const taken: bigint[] = [];
      await Promise.all(
        Array.from({ length: subject.networked ? 20 : 10 }, async (_, index) => {
          await subject.run(tenantA, async (unit) => {
            await new Promise((resolve) => setTimeout(resolve, (index * 7) % 5));
            const value = await unit.serials.next(ticket, 'seq', ['box']);
            taken.push(value);
            unit.afterCommit(() => committed.push(value));
          });
        }),
      );
      expect(new Set(taken).size).toBe(taken.length);
      expect(committed).toHaveLength(taken.length);
      expect(committed).toEqual([...committed].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
      expect(committed.at(-1)).toBe(BigInt(taken.length));
    });

    test('a field that is not a serial, or a count below one, is refused', async () => {
      expect(
        (await failureOf(subject.run(tenantA, (unit) => unit.serials.next(ticket, 'boxId', []))))
          .kind,
      ).toBe('validation');
      expect(
        (await failureOf(subject.run(tenantA, (unit) => unit.serials.next(ticket, 'seq', [], 0))))
          .kind,
      ).toBe('validation');
      expect(
        await failureOf(subject.run(tenantA, (unit) => unit.serials.next(owner, 'name', []))),
      ).toEqual({ kind: 'validation', code: 'core.malformed_request' });
    });

    test('a read-only unit cannot allocate', async () => {
      expect(
        await failureOf(subject.read(tenantA, (unit) => unit.serials.next(ticket, 'seq', ['a']))),
      ).toEqual({ kind: 'internal', code: 'core.internal' });
    });
  });
}
