import { describe, expect, test } from 'vitest';
import type { Condition } from './condition.ts';
import { evaluateCondition } from './evaluate-condition.ts';
import type { RelationMatcher } from './evaluate-options.ts';

type Case = readonly [
  name: string,
  condition: Condition,
  row: Record<string, unknown>,
  expected: boolean,
];

const astral = '\u{1F600}';
const bmpHigh = '～';

const cases: readonly Case[] = [
  ['eq equal', { op: 'eq', field: 'a', value: 1 }, { a: 1 }, true],
  ['eq different', { op: 'eq', field: 'a', value: 1 }, { a: 2 }, false],
  ['eq absent stored', { op: 'eq', field: 'a', value: 1 }, {}, false],
  ['eq null stored', { op: 'eq', field: 'a', value: 1 }, { a: null }, false],
  ['eq null operand', { op: 'eq', field: 'a', value: null }, { a: null }, false],
  ['eq undefined operand', { op: 'eq', field: 'a', value: undefined }, {}, false],
  [
    'eq instants',
    { op: 'eq', field: 'a', value: Temporal.Instant.from('2026-01-01T00:00:00Z') },
    { a: Temporal.Instant.from('2026-01-01T00:00:00Z') },
    true,
  ],
  [
    'eq bytes',
    { op: 'eq', field: 'a', value: new Uint8Array([1, 2]) },
    { a: new Uint8Array([1, 2]) },
    true,
  ],
  [
    'eq bytes differ',
    { op: 'eq', field: 'a', value: new Uint8Array([1, 2]) },
    { a: new Uint8Array([1, 3]) },
    false,
  ],
  ['ne different', { op: 'ne', field: 'a', value: 1 }, { a: 2 }, true],
  ['ne equal', { op: 'ne', field: 'a', value: 1 }, { a: 1 }, false],
  [
    'ne absent stored is not equal to a present value',
    { op: 'ne', field: 'a', value: 1 },
    {},
    true,
  ],
  ['ne null stored', { op: 'ne', field: 'a', value: 1 }, { a: null }, true],
  ['ne null operand is false', { op: 'ne', field: 'a', value: null }, { a: 1 }, false],
  ['ne null operand on absent is false', { op: 'ne', field: 'a', value: null }, {}, false],
  ['lt', { op: 'lt', field: 'a', value: 2 }, { a: 1 }, true],
  ['lt equal', { op: 'lt', field: 'a', value: 1 }, { a: 1 }, false],
  ['lte equal', { op: 'lte', field: 'a', value: 1 }, { a: 1 }, true],
  ['gt', { op: 'gt', field: 'a', value: 1 }, { a: 2 }, true],
  ['gt equal', { op: 'gt', field: 'a', value: 1 }, { a: 1 }, false],
  ['gte equal', { op: 'gte', field: 'a', value: 1 }, { a: 1 }, true],
  ['lt absent never matches', { op: 'lt', field: 'a', value: 1 }, {}, false],
  ['gte absent never matches', { op: 'gte', field: 'a', value: 1 }, { a: null }, false],
  ['lt null operand', { op: 'lt', field: 'a', value: null }, { a: 1 }, false],
  ['lt bigint against number', { op: 'lt', field: 'a', value: 2 }, { a: 1n }, true],
  ['lt NaN', { op: 'lt', field: 'a', value: 1 }, { a: Number.NaN }, false],
  ['lt booleans', { op: 'lt', field: 'a', value: true }, { a: false }, true],
  [
    'lt dates',
    { op: 'lt', field: 'a', value: Temporal.PlainDate.from('2026-02-01') },
    { a: Temporal.PlainDate.from('2026-01-31') },
    true,
  ],
  [
    'lt instants',
    { op: 'lt', field: 'a', value: Temporal.Instant.from('2026-01-01T00:00:01Z') },
    { a: Temporal.Instant.from('2026-01-01T00:00:00Z') },
    true,
  ],
  ['lt across types has no order', { op: 'lt', field: 'a', value: 'x' }, { a: 1 }, false],
  [
    'string order is by code point: astral above U+FF5E',
    { op: 'gt', field: 'a', value: bmpHigh },
    { a: astral },
    true,
  ],
  [
    'string order is by code point: lt',
    { op: 'lt', field: 'a', value: astral },
    { a: bmpHigh },
    true,
  ],
  ['in member', { op: 'in', field: 'a', value: [1, 2] }, { a: 2 }, true],
  ['in non-member', { op: 'in', field: 'a', value: [1, 2] }, { a: 3 }, false],
  ['in empty matches nothing', { op: 'in', field: 'a', value: [] }, { a: 1 }, false],
  ['in absent', { op: 'in', field: 'a', value: [1] }, {}, false],
  ['nin non-member', { op: 'nin', field: 'a', value: [1, 2] }, { a: 3 }, true],
  ['nin member', { op: 'nin', field: 'a', value: [1, 2] }, { a: 1 }, false],
  ['nin empty matches everything', { op: 'nin', field: 'a', value: [] }, { a: 1 }, true],
  ['nin empty matches absent', { op: 'nin', field: 'a', value: [] }, {}, true],
  ['nin absent is null-safe', { op: 'nin', field: 'a', value: [1] }, {}, true],
  ['contains substring', { op: 'contains', field: 'a', value: 'ell' }, { a: 'hello' }, true],
  [
    'contains is case-sensitive',
    { op: 'contains', field: 'a', value: 'ELL' },
    { a: 'hello' },
    false,
  ],
  ['contains astral', { op: 'contains', field: 'a', value: astral }, { a: `x${astral}y` }, true],
  ['contains on absent', { op: 'contains', field: 'a', value: 'x' }, {}, false],
  [
    'contains on a set',
    { op: 'contains', field: 'a', value: 'x' },
    { a: new Set(['x', 'y']) },
    true,
  ],
  [
    'contains on a set, missing',
    { op: 'contains', field: 'a', value: 'z' },
    { a: new Set(['x']) },
    false,
  ],
  ['contains on a list', { op: 'contains', field: 'a', value: 2 }, { a: [1, 2] }, true],
  ['contains on a list, missing', { op: 'contains', field: 'a', value: 3 }, { a: [1, 2] }, false],
  ['contains null operand', { op: 'contains', field: 'a', value: null }, { a: 'x' }, false],
  ['startsWith', { op: 'startsWith', field: 'a', value: 'he' }, { a: 'hello' }, true],
  [
    'startsWith is case-sensitive',
    { op: 'startsWith', field: 'a', value: 'He' },
    { a: 'hello' },
    false,
  ],
  ['startsWith not a prefix', { op: 'startsWith', field: 'a', value: 'lo' }, { a: 'hello' }, false],
  ['startsWith on absent', { op: 'startsWith', field: 'a', value: '' }, {}, false],
  ['isNull true on absent', { op: 'isNull', field: 'a', value: true }, {}, true],
  ['isNull true on null', { op: 'isNull', field: 'a', value: true }, { a: null }, true],
  ['isNull true on present', { op: 'isNull', field: 'a', value: true }, { a: 0 }, false],
  ['isNull false on present', { op: 'isNull', field: 'a', value: false }, { a: '' }, true],
  ['isNull false on absent', { op: 'isNull', field: 'a', value: false }, {}, false],
  ['and of none is true', { op: 'and', conditions: [] }, {}, true],
  ['or of none is false', { op: 'or', conditions: [] }, {}, false],
  [
    'and',
    {
      op: 'and',
      conditions: [
        { op: 'eq', field: 'a', value: 1 },
        { op: 'eq', field: 'b', value: 2 },
      ],
    },
    { a: 1, b: 2 },
    true,
  ],
  [
    'and with one failure',
    {
      op: 'and',
      conditions: [
        { op: 'eq', field: 'a', value: 1 },
        { op: 'eq', field: 'b', value: 2 },
      ],
    },
    { a: 1, b: 3 },
    false,
  ],
  [
    'or',
    {
      op: 'or',
      conditions: [
        { op: 'eq', field: 'a', value: 9 },
        { op: 'eq', field: 'b', value: 2 },
      ],
    },
    { a: 1, b: 2 },
    true,
  ],
  [
    'not over a false comparison on absent is true (two-valued)',
    { op: 'not', condition: { op: 'eq', field: 'a', value: 1 } },
    {},
    true,
  ],
  [
    'not over lt on absent is true (two-valued)',
    { op: 'not', condition: { op: 'lt', field: 'a', value: 1 } },
    {},
    true,
  ],
  ['in with a null element is false', { op: 'in', field: 'a', value: [null, 1] }, { a: 1 }, false],
  [
    'nin with a null element is false',
    { op: 'nin', field: 'a', value: [null, 2] },
    { a: 1 },
    false,
  ],
  [
    'nin with only a null element, absent stored',
    { op: 'nin', field: 'a', value: [null] },
    {},
    false,
  ],
  [
    'in with an undefined element is false',
    { op: 'in', field: 'a', value: [undefined] },
    { a: 1 },
    false,
  ],
  [
    'bigint beyond 2^53 does not equal the rounded number',
    { op: 'eq', field: 'a', value: 9007199254740992 },
    { a: 9007199254740993n },
    false,
  ],
  ['bigint equals the same integer number', { op: 'eq', field: 'a', value: 5 }, { a: 5n }, true],
  ['bigint does not equal a fraction', { op: 'eq', field: 'a', value: 5.5 }, { a: 5n }, false],
  [
    'contains on a set',
    { op: 'contains', field: 'a', value: 'x' },
    { a: new Set(['x', 'y']) },
    true,
  ],
  ['never', { op: 'never' }, { a: 1 }, false],
  ['not never', { op: 'not', condition: { op: 'never' } }, {}, true],
  ['inherited member is absent', { op: 'isNull', field: 'constructor', value: true }, {}, true],
];

describe('evaluateCondition, section 14.3.4 row by row', () => {
  test.each(cases)('%s', (_name, condition, row, expected) => {
    expect(evaluateCondition(condition, row)).toBe(expected);
  });
});

describe('value mapper', () => {
  const lower = (_field: string, value: unknown): unknown =>
    typeof value === 'string' ? value.toLowerCase() : value;

  test('compares N(stored) with N(operand)', () => {
    const condition: Condition = { op: 'eq', field: 'email', value: 'A@B.C' };
    expect(evaluateCondition(condition, { email: 'a@b.c' }, { mapValue: lower })).toBe(true);
    expect(evaluateCondition(condition, { email: 'a@b.c' })).toBe(false);
  });

  test('maps each element of a list', () => {
    const condition: Condition = { op: 'in', field: 'email', value: ['X', 'Y'] };
    expect(evaluateCondition(condition, { email: 'y' }, { mapValue: lower })).toBe(true);
    expect(
      evaluateCondition({ ...condition, op: 'nin' }, { email: 'y' }, { mapValue: lower }),
    ).toBe(false);
  });

  test('contains maps each element of a stored set or list, not the collection', () => {
    const condition: Condition = { op: 'contains', field: 'tags', value: 'A' };
    expect(evaluateCondition(condition, { tags: new Set(['a', 'b']) }, { mapValue: lower })).toBe(
      true,
    );
    expect(evaluateCondition(condition, { tags: ['b', 'a'] }, { mapValue: lower })).toBe(true);
    expect(evaluateCondition(condition, { tags: ['b'] }, { mapValue: lower })).toBe(false);
  });

  test('receives the field name, for the operand even when the stored value is absent', () => {
    const seen: string[] = [];
    const mapValue = (field: string, value: unknown): unknown => {
      seen.push(field);
      return value;
    };
    evaluateCondition({ op: 'eq', field: 'a', value: 1 }, { a: 1 }, { mapValue });
    evaluateCondition({ op: 'eq', field: 'a', value: 1 }, {}, { mapValue });
    expect(seen).toEqual(['a', 'a', 'a']);
  });
});

describe('relation quantifiers', () => {
  const where: Condition = { op: 'eq', field: 'userId', value: 'u1' };

  test('go through the matching callback with the node itself and the row', () => {
    const calls: unknown[] = [];
    const matching: RelationMatcher = (node, row) => {
      calls.push([node, row]);
      return node.op !== 'none';
    };
    const row = { id: 'r1' };
    const nodes = (['some', 'none', 'every', 'is'] as const).map(
      (op): Condition => ({ op, relation: 'members', where }),
    );
    for (const node of nodes) {
      expect(evaluateCondition(node, row, { matching })).toBe(node.op !== 'none');
    }
    expect(calls).toHaveLength(4);
    expect((calls[0] as unknown[])[0]).toBe(nodes[0]);
    expect((calls[0] as unknown[])[1]).toBe(row);
  });

  test('compose with the boolean operators', () => {
    const matching: RelationMatcher = () => true;
    const condition: Condition = { op: 'not', condition: { op: 'some', relation: 'r', where } };
    expect(evaluateCondition(condition, {}, { matching })).toBe(false);
  });

  test('a quantifier without a callback is a programming error', () => {
    expect(() => evaluateCondition({ op: 'some', relation: 'r', where }, {})).toThrow(TypeError);
  });
});

describe('misuse', () => {
  test('in and nin need an array', () => {
    expect(() => evaluateCondition({ op: 'in', field: 'a', value: 1 }, { a: 1 })).toThrow(
      TypeError,
    );
    expect(() => evaluateCondition({ op: 'nin', field: 'a', value: 'x' }, {})).toThrow(TypeError);
  });

  test('isNull needs a boolean', () => {
    expect(() =>
      evaluateCondition({ op: 'isNull', field: 'a', value: 1 as unknown as boolean }, {}),
    ).toThrow(TypeError);
  });
});
