import { conformanceEntities, conformanceId, conformanceScopes } from '@keelwerk/data/conformance';
import { describe, expect, test } from 'vitest';
import { appendOf } from './append-of.ts';
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
      // The order in which the unit promises resolve is not the commit order: the commit returns to
      // the caller after a network hop of its own. The database records the commit order itself, as
      // the position of an event each unit appends next to its serial (15.1.4), so the values are
      // compared with that.
      const taken = new Map<number, bigint>();
      const count = subject.networked ? 20 : 10;
      await Promise.all(
        Array.from({ length: count }, async (_, index) => {
          await subject.run(tenantA, async (unit) => {
            await new Promise((resolve) => setTimeout(resolve, (index * 7) % 5));
            taken.set(index, await unit.serials.next(ticket, 'seq', ['box']));
            await unit.events.append([appendOf(1 + index, [1])]);
          });
        }),
      );
      const values = [...taken.values()];
      expect(new Set(values).size).toBe(count);
      const log = await subject.read(tenantA, (unit) =>
        unit.events.readAll(null, { limit: count + 10 }),
      );
      const inCommitOrder = log.events.map((event) => {
        const index = Array.from(taken.keys()).find(
          (candidate) => conformanceId(1 + candidate) === event.stream.id,
        );
        return index === undefined ? undefined : taken.get(index);
      });
      expect(inCommitOrder).toHaveLength(count);
      expect(inCommitOrder).toEqual(Array.from({ length: count }, (_, n) => BigInt(n + 1)));
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
