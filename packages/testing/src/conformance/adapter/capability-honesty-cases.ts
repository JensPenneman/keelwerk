import type { Condition } from '@keelwerk/core';
import { conformanceEntities, conformanceScopes } from '@keelwerk/data/conformance';
import { describe, expect, test } from 'vitest';
import type { ConformanceSubject } from './conformance-subject.ts';
import { failureOf } from './failure-of.ts';
import { rowAt } from './row-at.ts';

const { probe, account } = conformanceEntities;
const { tenantA } = conformanceScopes;

/** Representative fields and the operators their kinds take (14.3.4), stated here. */
const takes: readonly (readonly [string, readonly string[], unknown])[] = [
  [
    'label',
    ['eq', 'ne', 'lt', 'lte', 'gt', 'gte', 'in', 'nin', 'contains', 'startsWith', 'isNull'],
    'a',
  ],
  ['n', ['eq', 'ne', 'lt', 'lte', 'gt', 'gte', 'in', 'nin', 'isNull'], 1],
  ['price', ['eq', 'ne', 'lt', 'lte', 'gt', 'gte', 'in', 'nin', 'isNull'], '1.00'],
  ['flag', ['eq', 'ne', 'isNull'], true],
  ['tags', ['contains', 'isNull'], 'x'],
  ['raw', ['eq', 'ne', 'isNull'], new Uint8Array([1])],
  ['payload', ['isNull'], true],
];

function condition(op: string, field: string, sample: unknown): Condition {
  if (op === 'isNull') return { op: 'isNull', field, value: true };
  if (op === 'in' || op === 'nin') return { op, field, value: [sample] };
  return { op, field, value: sample } as Condition;
}

export function capabilityHonestyCases(subject: ConformanceSubject): void {
  describe('capability honesty (14.3.3, 14.10 case 12)', () => {
    test('the capabilities describe the adapter under test', () => {
      const c = subject.capabilities();
      expect(c.dialect).not.toBe('');
      expect(c.eventStore).toBe(true);
      expect(c.transactions.savepoints).toBe(true);
      expect(c.placements).toContain(subject.placement.strategy);
      expect(c.maxIdentifierLength).toBeGreaterThan(0);
      expect(Number.isInteger(c.encryptedQueries.maxScan)).toBe(true);
      expect(c.encryptedQueries.maxScan).toBeGreaterThan(0);
      expect(['single', 'host', 'network']).toContain(c.processes);
      expect(c.transactions.isolation.length).toBeGreaterThan(0);
    });

    test('every optional store member exists exactly when its capability is declared', async () => {
      const c = subject.capabilities();
      const members = await subject.read(tenantA, async (unit) => ({
        search: unit.rows.search !== undefined,
        countBefore: unit.rows.countBefore !== undefined,
        lock: unit.rows.lock !== undefined,
      }));
      expect(members.search).toBe(c.search !== false);
      expect(members.countBefore).toBe(c.positionPaging !== false);
      expect(members.lock).toBe(c.rowLocks !== false);
    });

    test('an operator declared unsupported fails with unsupported, and no other operator does', async () => {
      await subject.run(tenantA, (unit) =>
        unit.rows.insert(probe, [
          rowAt(1, {
            label: 'a',
            n: 1,
            price: '1.00',
            flag: true,
            tags: new Set(['x']),
            raw: new Uint8Array([1]),
          }),
        ]),
      );
      const declared = subject.capabilities().unsupportedConditions;
      for (const [field, ops, sample] of takes) {
        for (const op of ops) {
          const listed = declared.some(
            (d) =>
              d.op === op &&
              (d.kinds === undefined || d.kinds.includes(probe.fields[field]?.kind ?? 'string')),
          );
          const outcome = subject.read(tenantA, (unit) =>
            unit.rows.find(probe, { where: condition(op, field, sample) }),
          );
          if (listed) expect((await failureOf(outcome)).kind).toBe('unsupported');
          else await expect(outcome).resolves.toBeDefined();
        }
      }
    });

    test('an operator the kind does not take is a validation error, never unsupported', async () => {
      const refused = await failureOf(
        subject.read(tenantA, (unit) =>
          unit.rows.find(probe, { where: { op: 'contains', field: 'n', value: 1 } }),
        ),
      );
      expect(refused.kind).toBe('validation');
    });

    test('rows.search answers when it is declared', async (t) => {
      if (subject.capabilities().search === false) return t.skip();
      await subject.run(tenantA, (unit) =>
        unit.rows.insert(account, [
          rowAt(1, { handle: 'findable' }),
          rowAt(2, { handle: 'other' }),
        ]),
      );
      const found = async (text: string) =>
        subject.read(tenantA, (unit) => {
          if (unit.rows.search === undefined) throw new Error('search is declared but missing');
          return unit.rows.search(account, { index: 'text', match: { text } });
        });
      expect((await found('findable')).rows.map((row) => row.handle)).toEqual(['findable']);
      expect((await found('absent words')).rows).toEqual([]);
    });
  });
}
