import { RetryableUnitError } from '@keelwerk/core';
import { conformanceEntities, conformanceScopes } from '@keelwerk/data/conformance';
import { describe, expect, test } from 'vitest';
import { appendOf } from './append-of.ts';
import type { ConformanceSubject } from './conformance-subject.ts';
import { failureOf } from './failure-of.ts';
import { rowAt } from './row-at.ts';

const { owner, setting } = conformanceEntities;
const { tenantA, tenantB, tenantC, backend, otherBackend, deployment } = conformanceScopes;

const names = async (subject: ConformanceSubject): Promise<unknown[]> =>
  subject.read(tenantA, async (unit) =>
    (await unit.rows.find(owner, { sort: [{ field: 'id', direction: 'asc' }] })).rows.map(
      (row) => row.name,
    ),
  );

const boom = new Error('boom');
/** A write in a read-only unit; PostgreSQL's read-only transaction error must map to the same kind and code. */
const refusedWrite = { kind: 'internal', code: 'core.internal' };

export function unitCases(subject: ConformanceSubject): void {
  describe('units and savepoints (14.3.6, 14.10 case 4)', () => {
    test('a unit commits what it wrote, and a thrown error leaves nothing behind', async () => {
      await subject.run(tenantA, (unit) => unit.rows.insert(owner, [rowAt(1, { name: 'kept' })]));
      await expect(
        subject.run(tenantA, async (unit) => {
          await unit.rows.insert(owner, [rowAt(2, { name: 'lost' })]);
          await unit.usage.add('requests', 5n);
          await unit.serials.next(conformanceEntities.ticket, 'seq', ['box']);
          throw boom;
        }),
      ).rejects.toBe(boom);
      expect(await names(subject)).toEqual(['kept']);
      expect(await subject.read(tenantA, (unit) => unit.usage.get('requests'))).toBe(0n);
    });

    test('a unit sees its own writes before it commits', async () => {
      const seen = await subject.run(tenantA, async (unit) => {
        await unit.rows.insert(owner, [rowAt(1, { name: 'early' })]);
        return unit.rows.count(owner);
      });
      expect(seen).toBe(1);
    });

    test('a savepoint that throws is rolled back and rethrown; the unit goes on', async () => {
      await subject.run(tenantA, async (unit) => {
        await unit.rows.insert(owner, [rowAt(1, { name: 'outer' })]);
        const failed = await unit
          .nested(async (inner) => {
            await inner.rows.insert(owner, [rowAt(2, { name: 'inner' })]);
            expect(await inner.rows.count(owner)).toBe(2);
            throw boom;
          })
          .catch((error: unknown) => error);
        expect(failed).toBe(boom);
        expect(await unit.rows.count(owner)).toBe(1);
        const kept = await unit.nested(async (inner) => {
          await inner.rows.insert(owner, [rowAt(3, { name: 'second' })]);
          return 'ok';
        });
        expect(kept).toBe('ok');
      });
      expect(await names(subject)).toEqual(['outer', 'second']);
    });

    test('savepoints nest, and an inner failure caught in the outer one keeps the outer work', async () => {
      await subject.run(tenantA, async (outer) => {
        await outer.nested(async (middle) => {
          await middle.rows.insert(owner, [rowAt(1, { name: 'middle' })]);
          await middle
            .nested(async (inner) => {
              await inner.rows.insert(owner, [rowAt(2, { name: 'inner' })]);
              throw boom;
            })
            .catch(() => undefined);
        });
      });
      expect(await names(subject)).toEqual(['middle']);
    });

    test('a failing savepoint takes back the events and the serial values it took', async () => {
      const { ticket } = conformanceEntities;
      const next = await subject.run(tenantA, async (unit) => {
        await unit
          .nested(async (inner) => {
            await inner.serials.next(ticket, 'seq', ['b'], 4);
            await inner.events.append([appendOf(1, [1])]);
            throw boom;
          })
          .catch(() => undefined);
        return unit.serials.next(ticket, 'seq', ['b']);
      });
      expect(next).toBe(1n);
    });

    test('afterCommit hooks run once after the commit, and never for a rolled-back unit or savepoint', async () => {
      const ran: string[] = [];
      await subject.run(tenantA, async (unit) => {
        unit.afterCommit(() => ran.push('unit'));
        await unit
          .nested(async (inner) => {
            inner.afterCommit(() => ran.push('rolled back'));
            throw boom;
          })
          .catch(() => undefined);
        await unit.nested(async (inner) => {
          inner.afterCommit(() => ran.push('savepoint'));
        });
        expect(ran).toEqual([]);
      });
      expect(ran).toEqual(['unit', 'savepoint']);
      await subject
        .run(tenantA, async (unit) => {
          unit.afterCommit(() => ran.push('never'));
          throw boom;
        })
        .catch(() => undefined);
      expect(ran).toEqual(['unit', 'savepoint']);
    });

    test('a read-only unit refuses every write and leaves nothing behind', async () => {
      const attempts = [
        (unit: Parameters<Parameters<ConformanceSubject['read']>[1]>[0]) =>
          unit.rows.insert(owner, [rowAt(1, { name: 'no' })]),
        (unit: Parameters<Parameters<ConformanceSubject['read']>[1]>[0]) =>
          unit.usage.add('requests', 1n),
        (unit: Parameters<Parameters<ConformanceSubject['read']>[1]>[0]) =>
          unit.events.append([appendOf(1, [1])]),
      ];
      for (const attempt of attempts) {
        expect(await failureOf(subject.read(tenantA, async (unit) => attempt(unit)))).toEqual(
          refusedWrite,
        );
      }
      expect(await names(subject)).toEqual([]);
      expect(await subject.read(tenantA, async (unit) => unit.readOnly)).toBe(true);
      expect(await subject.run(tenantA, async (unit) => unit.readOnly)).toBe(false);
    });

    test('a read-only savepoint refuses writes, and the unit can write again after it', async () => {
      await subject.run(tenantA, async (unit) => {
        expect(
          await failureOf(
            unit.nested((inner) => inner.rows.insert(owner, [rowAt(1, { name: 'no' })]), {
              readOnly: true,
            }),
          ),
        ).toEqual(refusedWrite);
        expect(await unit.nested(async (inner) => inner.readOnly, { readOnly: true })).toBe(true);
        await unit.rows.insert(owner, [rowAt(2, { name: 'yes' })]);
      });
      expect(await names(subject)).toEqual(['yes']);
    });

    test('a savepoint never widens a read-only unit', async () => {
      await subject.read(tenantA, async (unit) => {
        expect(await unit.nested(async (inner) => inner.readOnly, { readOnly: false })).toBe(true);
        expect(
          await failureOf(
            unit.nested((inner) => inner.rows.insert(owner, [rowAt(1, { name: 'no' })]), {
              readOnly: false,
            }),
          ),
        ).toEqual(refusedWrite);
      });
    });
  });

  describe('a tenant unit reads its backend through a savepoint', () => {
    const seedBackend = async (): Promise<void> => {
      await subject.run(backend, (unit) =>
        unit.rows.insert(setting, [rowAt(1, { key: 'theme', value: 'dark' })]),
      );
      await subject.run(otherBackend, (unit) =>
        unit.rows.insert(setting, [rowAt(1, { key: 'theme', value: 'light' })]),
      );
    };

    test('{ as: its backend, readOnly: true } reads the backend rows and nothing else', async () => {
      await seedBackend();
      const value = await subject.run(tenantA, (unit) =>
        unit.nested(
          async (inner) => {
            expect(inner.scope).toEqual(backend);
            expect(inner.readOnly).toBe(true);
            return (await inner.rows.findOne(setting, {}))?.value;
          },
          { as: backend, readOnly: true },
        ),
      );
      expect(value).toBe('dark');
    });

    test('the savepoint cannot write the backend, and the tenant unit keeps its own scope afterwards', async () => {
      await seedBackend();
      await subject.run(tenantA, async (unit) => {
        expect(
          await failureOf(
            unit.nested((inner) => inner.rows.insert(setting, [rowAt(2, { key: 'x' })]), {
              as: backend,
              readOnly: true,
            }),
          ),
        ).toEqual(refusedWrite);
        expect(unit.scope).toEqual(tenantA);
        await unit.rows.insert(owner, [rowAt(1, { name: 'still tenant' })]);
      });
      expect(await names(subject)).toEqual(['still tenant']);
      expect(await subject.read(backend, (unit) => unit.rows.count(setting))).toBe(1);
    });

    test.each([
      ['its backend without readOnly', { as: backend }],
      ['its backend with readOnly false', { as: backend, readOnly: false }],
      ['another backend', { as: otherBackend, readOnly: true }],
      ['another tenant', { as: tenantB, readOnly: true }],
      ['a tenant of another backend', { as: tenantC, readOnly: true }],
      ['the deployment', { as: deployment, readOnly: true }],
      ['its own tenant scope', { as: tenantA, readOnly: true }],
    ] as const)('is refused with core.forbidden: as %s', async (_name, options) => {
      await seedBackend();
      const refused = subject.run(tenantA, (unit) => unit.nested(async () => 'reached', options));
      expect(await failureOf(refused)).toEqual({ kind: 'forbidden', code: 'core.forbidden' });
    });

    test.each([
      ['a backend unit', backend, { as: otherBackend, readOnly: true }],
      ['a backend unit as itself', backend, { as: backend, readOnly: true }],
      ['the deployment unit', deployment, { as: backend, readOnly: true }],
      ['another tenant', tenantB, { as: otherBackend, readOnly: true }],
    ] as const)('only a tenant unit may name another scope: %s', async (_name, scope, options) => {
      const refused = subject.run(scope, (unit) => unit.nested(async () => 'reached', options));
      expect(await failureOf(refused)).toEqual({ kind: 'forbidden', code: 'core.forbidden' });
    });
  });

  describe('timeouts, signals and isolation levels', () => {
    test('a unit waiting for the namespace gives up after timeoutMs with core.timeout', async (t) => {
      if (subject.capabilities().processes !== 'single') return t.skip();
      const refused = await subject
        .run(tenantA, () => failureOf(subject.run(tenantB, async () => 1, { timeoutMs: 20 })))
        .catch((error: unknown) => error);
      expect(refused).toEqual({ kind: 'unavailable', code: 'core.timeout' });
    });

    test('an aborted signal refuses a unit before it starts, and a unit that ends aborted rolls back', async () => {
      const controller = new AbortController();
      controller.abort(new Error('stop'));
      await expect(
        subject.run(tenantA, async () => 1, { signal: controller.signal }),
      ).rejects.toThrow('stop');
      const late = new AbortController();
      await expect(
        subject.run(
          tenantA,
          async (unit) => {
            await unit.rows.insert(owner, [rowAt(1, { name: 'late' })]);
            late.abort(new Error('late'));
          },
          { signal: late.signal },
        ),
      ).rejects.toThrow('late');
      expect(await names(subject)).toEqual([]);
    });

    test('every isolation level the adapter lists opens a unit that reads and writes', async () => {
      for (const isolation of subject.capabilities().transactions.isolation) {
        await subject.run(
          tenantA,
          (unit) => unit.rows.insert(owner, [rowAt(10, { name: isolation })]),
          {
            isolation,
          },
        );
        const found = await subject.read(tenantA, (unit) => unit.rows.count(owner));
        expect(found).toBe(1);
        await subject.run(tenantA, (unit) => unit.rows.purge(owner, [rowAt(10).id as string]));
      }
    });

    test('serializable units do not both pass a check that the other invalidates', async (t) => {
      if (!subject.capabilities().transactions.isolation.includes('serializable')) return t.skip();
      const claim = async (n: number): Promise<'claimed' | 'retry'> =>
        subject
          .run(
            tenantA,
            async (unit) => {
              if ((await unit.rows.count(owner)) === 0) {
                await new Promise((resolve) => setTimeout(resolve, 10));
                await unit.rows.insert(owner, [rowAt(n, { name: `claim ${n}` })]);
              }
              return 'claimed' as const;
            },
            { isolation: 'serializable' },
          )
          .catch((error: unknown) => {
            if (error instanceof RetryableUnitError) return 'retry' as const;
            throw error;
          });
      await Promise.all([claim(1), claim(2)]);
      await claim(3);
      expect(await subject.read(tenantA, (unit) => unit.rows.count(owner))).toBe(1);
    });
  });
}
