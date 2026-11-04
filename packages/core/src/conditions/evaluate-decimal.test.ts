import { describe, expect, test } from 'vitest';
import type { Condition } from './condition.ts';
import { evaluateCondition } from './evaluate-condition.ts';
import type { EvaluateOptions } from './evaluate-options.ts';

const decimalKind: EvaluateOptions = { kindOf: (field) => (field === 'd' ? 'decimal' : undefined) };

type DecimalCase = readonly [
  name: string,
  condition: Condition,
  row: Record<string, unknown>,
  expected: boolean,
];

const decimalCases: readonly DecimalCase[] = [
  ['10 is greater than 9', { op: 'gt', field: 'd', value: '9' }, { d: '10' }, true],
  ['10 is not less than 9', { op: 'lt', field: 'd', value: '9' }, { d: '10' }, false],
  ['1.50 equals 1.5', { op: 'eq', field: 'd', value: '1.5' }, { d: '1.50' }, true],
  ['1.50 does not differ from 1.5', { op: 'ne', field: 'd', value: '1.5' }, { d: '1.50' }, false],
  ['leading zeros are ignored', { op: 'eq', field: 'd', value: '007' }, { d: '7' }, true],
  ['negative zero equals zero', { op: 'eq', field: 'd', value: '0.00' }, { d: '-0.0' }, true],
  ['-10 is less than -9', { op: 'lt', field: 'd', value: '-9' }, { d: '-10' }, true],
  ['-1 is less than 0.1', { op: 'lt', field: 'd', value: '0.1' }, { d: '-1' }, true],
  ['0.25 is less than 0.3', { op: 'lt', field: 'd', value: '0.3' }, { d: '0.25' }, true],
  ['0.5 is less than 0.51', { op: 'lt', field: 'd', value: '0.51' }, { d: '0.5' }, true],
  ['lte on equal values', { op: 'lte', field: 'd', value: '2.0' }, { d: '2' }, true],
  ['gte on a larger fraction', { op: 'gte', field: 'd', value: '2.01' }, { d: '2.001' }, false],
  ['in matches by value', { op: 'in', field: 'd', value: ['3.0', '4'] }, { d: '3' }, true],
  ['nin excludes by value', { op: 'nin', field: 'd', value: ['3.0'] }, { d: '3.00' }, false],
  ['a sign prefix is accepted', { op: 'eq', field: 'd', value: '+1' }, { d: '1.0' }, true],
];

describe('decimal fields compare by numeric value', () => {
  test.each(decimalCases)('%s', (_name, condition, row, expected) => {
    expect(evaluateCondition(condition, row, decimalKind)).toBe(expected);
  });

  test('without the kind the same strings compare as text', () => {
    expect(evaluateCondition({ op: 'lt', field: 'd', value: '9' }, { d: '10' })).toBe(true);
    expect(evaluateCondition({ op: 'eq', field: 'd', value: '1.5' }, { d: '1.50' })).toBe(false);
  });

  test('other fields keep their own comparison', () => {
    expect(evaluateCondition({ op: 'lt', field: 's', value: '9' }, { s: '10' }, decimalKind)).toBe(
      true,
    );
  });
});
