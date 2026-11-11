import { describe, expect, test } from 'vitest';
import { field } from '../fields/field.ts';
import { shape } from '../fields/shape.ts';
import { checkFlagValues } from './check-flag-values.ts';
import type { FlagSpec } from './flag-spec.ts';
import type { FlagServe } from './flag-targeting.ts';

const base = { level: 'tenant', purpose: 'release' } as const;
const boolean: FlagSpec = { ...base, key: 'm.on', kind: 'boolean', default: false };
const layout: FlagSpec = {
  ...base,
  key: 'm.layout',
  kind: 'variant',
  variants: ['control', 'compact', 'wide'],
  default: 'control',
};
const limit: FlagSpec = { ...base, key: 'm.limit', kind: 'number', min: 1, max: 10, default: 5 };

function through(flag: FlagSpec, fallthrough: FlagServe): void {
  checkFlagValues(flag, { rules: [], fallthrough });
}

describe('checkFlagValues', () => {
  test('a value of another kind is refused', () => {
    expect(() => through(boolean, { value: 'yes' })).toThrow('fallthrough.value');
    expect(() => through(limit, { value: 11 })).toThrow('maximum');
    expect(() => through(limit, { value: 3 })).not.toThrow();
  });

  test('an undeclared variant is refused', () => {
    expect(() => through(layout, { value: 'tiny' })).toThrow('not a declared variant');
  });

  test('shares out of declared order are refused', () => {
    const shares = (first: string, second: string): FlagServe => ({
      split: [
        { value: first, weight: 5000 },
        { value: second, weight: 5000 },
      ],
    });
    expect(() => through(layout, shares('compact', 'control'))).toThrow('declared order');
    expect(() => through(layout, shares('control', 'compact'))).not.toThrow();
    expect(() =>
      through(boolean, {
        split: [
          { value: false, weight: 5000 },
          { value: true, weight: 5000 },
        ],
      }),
    ).toThrow('true before false');
  });

  test('a split on a deployment-level flag is refused', () => {
    const deployment: FlagSpec = { ...boolean, level: 'deployment' };
    expect(() => through(deployment, { split: [{ value: true, weight: 10_000 }] })).toThrow(
      'no targeting key',
    );
  });

  test('a variant that is not String(value) is refused', () => {
    expect(() => through(boolean, { value: true, variant: 'yes' })).toThrow('fallthrough.variant');
    expect(() => through(boolean, { value: true, variant: 'true' })).not.toThrow();
  });

  test("a json flag's schema refuses a value on write", () => {
    const document: FlagSpec = {
      ...base,
      key: 'm.doc',
      kind: 'json',
      schema: shape({ size: field.integer() }),
      default: { size: 1 },
    };
    expect(() => through(document, { value: { size: 'big' }, variant: 'big' })).toThrow(
      'fallthrough.value',
    );
    expect(() => through(document, { value: { size: 2 }, variant: 'two' })).not.toThrow();
  });

  test("a json flag's shape that converts the value refuses it on write", () => {
    const document: FlagSpec = {
      ...base,
      key: 'm.doc',
      kind: 'json',
      schema: shape({ size: field.integer().default(3) }),
      default: { size: 1 },
    };
    expect(() => through(document, { value: {}, variant: 'empty' })).toThrow(
      'may not convert values',
    );
    expect(() => through(document, { value: { size: 3 }, variant: 'three' })).not.toThrow();
  });

  test("a json flag's shape that turns a string into a Temporal value refuses it on write", () => {
    const document: FlagSpec = {
      ...base,
      key: 'm.doc',
      kind: 'json',
      schema: shape({ from: field.date() }),
      default: { from: '2026-01-01' },
    };
    expect(() => through(document, { value: { from: '2026-11-11' }, variant: 'day' })).toThrow(
      'is not plain JSON',
    );
  });

  test("a json flag's shape that outputs a value a store cannot keep names that problem", () => {
    const document: FlagSpec = {
      ...base,
      key: 'm.doc',
      kind: 'json',
      schema: shape({ note: field.string() }),
      default: { note: 'a' },
    };
    expect(() => through(document, { value: { note: 'a\u0000b' }, variant: 'nul' })).toThrow(
      'holds U+0000',
    );
    expect(() => through(document, { value: { note: 'a\u0000b' }, variant: 'nul' })).not.toThrow(
      'may not convert values',
    );
  });
});
