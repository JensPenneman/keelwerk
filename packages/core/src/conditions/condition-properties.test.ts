import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { compareCodePoints } from './compare-code-points.ts';
import type { Condition } from './condition.ts';
import { evaluateCondition } from './evaluate-condition.ts';

const astral = '\u{1F600}';
const bmpHigh = '\uFF5E';

describe('compareCodePoints', () => {
  test('differs from UTF-16 order beyond the Basic Multilingual Plane', () => {
    expect(astral < bmpHigh).toBe(true);
    expect(compareCodePoints(astral, bmpHigh)).toBe(1);
    expect(compareCodePoints(bmpHigh, astral)).toBe(-1);
  });

  test('prefix is smaller, equal is zero', () => {
    expect(compareCodePoints('ab', 'abc')).toBe(-1);
    expect(compareCodePoints('abc', 'ab')).toBe(1);
    expect(compareCodePoints('', '')).toBe(0);
    expect(compareCodePoints(`a${astral}`, `a${astral}`)).toBe(0);
  });

  test('agrees with the code point arrays on any string', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary' }), fc.string({ unit: 'binary' }), (a, b) => {
        const left = a.toWellFormed();
        const right = b.toWellFormed();
        const cps = (s: string): number[] => [...s].map((c) => c.codePointAt(0) ?? 0);
        const x = cps(left);
        const y = cps(right);
        let expected: -1 | 0 | 1 = 0;
        for (let i = 0; i < Math.min(x.length, y.length) && expected === 0; i++) {
          const l = x[i] ?? 0;
          const r = y[i] ?? 0;
          if (l !== r) expected = l < r ? -1 : 1;
        }
        if (expected === 0 && x.length !== y.length) expected = x.length < y.length ? -1 : 1;
        expect(compareCodePoints(left, right)).toBe(expected);
      }),
    );
  });
});

describe('properties', () => {
  const leaf = fc.oneof(
    fc.record({
      op: fc.constantFrom('eq', 'ne', 'lt', 'lte', 'gt', 'gte'),
      field: fc.constantFrom('a', 'b'),
      value: fc.oneof(fc.integer({ min: -3, max: 3 }), fc.constant(null)),
    }),
    fc.record({ op: fc.constant('isNull'), field: fc.constantFrom('a', 'b'), value: fc.boolean() }),
    fc.record({
      op: fc.constantFrom('in', 'nin'),
      field: fc.constantFrom('a', 'b'),
      value: fc.array(fc.oneof(fc.integer({ min: -3, max: 3 }), fc.constant(null)), {
        maxLength: 3,
      }),
    }),
    fc.constant({ op: 'never' }),
  ) as fc.Arbitrary<Condition>;
  const condition = fc.letrec<{ node: Condition }>((tie) => ({
    node: fc.oneof(
      { depthSize: 'small', maxDepth: 3 },
      leaf,
      fc.record({ op: fc.constant('not' as const), condition: tie('node') }),
      fc.record({
        op: fc.constantFrom('and' as const, 'or' as const),
        conditions: fc.array(tie('node'), { maxLength: 3 }),
      }),
    ),
  })).node;
  const row = fc.record(
    {
      a: fc.option(fc.integer({ min: -3, max: 3 })),
      b: fc.option(fc.integer({ min: -3, max: 3 })),
    },
    { requiredKeys: [] },
  );

  test('double negation', () => {
    fc.assert(
      fc.property(condition, row, (c, r) => {
        const twice: Condition = { op: 'not', condition: { op: 'not', condition: c } };
        expect(evaluateCondition(twice, r)).toBe(evaluateCondition(c, r));
      }),
    );
  });

  test('De Morgan', () => {
    fc.assert(
      fc.property(fc.array(condition, { maxLength: 4 }), row, (list, r) => {
        const notAnd: Condition = { op: 'not', condition: { op: 'and', conditions: list } };
        const orNot: Condition = {
          op: 'or',
          conditions: list.map((c) => ({ op: 'not', condition: c })),
        };
        expect(evaluateCondition(notAnd, r)).toBe(evaluateCondition(orNot, r));
        const notOr: Condition = { op: 'not', condition: { op: 'or', conditions: list } };
        const andNot: Condition = {
          op: 'and',
          conditions: list.map((c) => ({ op: 'not', condition: c })),
        };
        expect(evaluateCondition(notOr, r)).toBe(evaluateCondition(andNot, r));
      }),
    );
  });

  test('nin is the null-safe negation of in', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: -3, max: 3 }), { maxLength: 3 }), row, (list, r) => {
        const inside = evaluateCondition({ op: 'in', field: 'a', value: list }, r);
        expect(evaluateCondition({ op: 'nin', field: 'a', value: list }, r)).toBe(!inside);
      }),
    );
  });
});
