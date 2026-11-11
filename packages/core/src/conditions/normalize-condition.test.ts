import { describe, expect, test } from 'vitest';
import { KeelwerkError } from '../errors/keelwerk-error.ts';
import { conditionFields } from './condition-fields.ts';
import { normalizeCondition } from './normalize-condition.ts';
import { normalizeWireFilter } from './normalize-wire-filter.ts';

describe('normalizeCondition', () => {
  test('a bare value is eq', () => {
    expect(normalizeCondition({ ownerId: 'u1' })).toEqual({
      op: 'eq',
      field: 'ownerId',
      value: 'u1',
    });
  });

  test('several keys form an and, in key order', () => {
    expect(normalizeCondition({ a: 1, b: 2 })).toEqual({
      op: 'and',
      conditions: [
        { op: 'eq', field: 'a', value: 1 },
        { op: 'eq', field: 'b', value: 2 },
      ],
    });
  });

  test('an empty object matches everything', () => {
    expect(normalizeCondition({})).toEqual({ op: 'and', conditions: [] });
  });

  test('operators of one field form an and', () => {
    expect(normalizeCondition({ n: { gte: 1, lt: 5 } })).toEqual({
      op: 'and',
      conditions: [
        { op: 'gte', field: 'n', value: 1 },
        { op: 'lt', field: 'n', value: 5 },
      ],
    });
  });

  test('every operator keeps its name, nin included', () => {
    for (const op of ['eq', 'ne', 'lt', 'lte', 'gt', 'gte', 'contains', 'startsWith'] as const) {
      expect(normalizeCondition({ f: { [op]: 'x' } })).toEqual({ op, field: 'f', value: 'x' });
    }
    expect(normalizeCondition({ f: { in: [1] } })).toEqual({ op: 'in', field: 'f', value: [1] });
    expect(normalizeCondition({ f: { nin: [] } })).toEqual({ op: 'nin', field: 'f', value: [] });
    expect(normalizeCondition({ f: { isNull: false } })).toEqual({
      op: 'isNull',
      field: 'f',
      value: false,
    });
  });

  test('an interpolated null or undefined becomes never', () => {
    const never = { op: 'never' };
    expect(normalizeCondition({ ownerId: undefined })).toEqual(never);
    expect(normalizeCondition({ ownerId: null })).toEqual(never);
    expect(normalizeCondition({ f: { eq: undefined } })).toEqual(never);
    expect(normalizeCondition({ f: { ne: null } })).toEqual(never);
    expect(normalizeCondition({ f: { gt: null } })).toEqual(never);
    expect(normalizeCondition({ f: { in: undefined } })).toEqual(never);
    expect(normalizeCondition({ f: { contains: null } })).toEqual(never);
  });

  test('a null or undefined inside an in or nin list is rejected, never matched', () => {
    for (const input of [{ f: { in: [1, null] } }, { f: { nin: [undefined] } }]) {
      expect(() => normalizeCondition(input)).toThrow(
        expect.objectContaining({ kind: 'internal', code: 'core.internal' }),
      );
      expect(() => normalizeWireFilter(input)).toThrow(
        expect.objectContaining({ kind: 'validation', code: 'core.malformed_request' }),
      );
    }
  });

  test('and, or and not nest', () => {
    expect(normalizeCondition({ or: [{ a: 1 }, { not: { b: 2 } }] })).toEqual({
      op: 'or',
      conditions: [
        { op: 'eq', field: 'a', value: 1 },
        { op: 'not', condition: { op: 'eq', field: 'b', value: 2 } },
      ],
    });
    expect(normalizeCondition({ and: [] })).toEqual({ op: 'and', conditions: [] });
    expect(normalizeCondition({ or: undefined })).toEqual({ op: 'and', conditions: [] });
  });

  test('relation quantifiers carry a normalised where', () => {
    expect(normalizeCondition({ team: { members: { some: { userId: 's1' } } } })).toEqual({
      op: 'some',
      relation: 'team.members',
      where: { op: 'eq', field: 'userId', value: 's1' },
    });
    expect(
      normalizeCondition({ a: { b: { c: { every: { x: 1 } } }, d: { none: { y: 2 } } } }),
    ).toEqual({
      op: 'and',
      conditions: [
        { op: 'every', relation: 'a.b.c', where: { op: 'eq', field: 'x', value: 1 } },
        { op: 'none', relation: 'a.d', where: { op: 'eq', field: 'y', value: 2 } },
      ],
    });
    expect(
      normalizeCondition({
        members: { some: { userId: 's1' }, none: { revokedAt: { isNull: false } } },
      }),
    ).toEqual({
      op: 'and',
      conditions: [
        { op: 'some', relation: 'members', where: { op: 'eq', field: 'userId', value: 's1' } },
        {
          op: 'none',
          relation: 'members',
          where: { op: 'isNull', field: 'revokedAt', value: false },
        },
      ],
    });
    expect(normalizeCondition({ owner: { is: { id: undefined } } })).toEqual({
      op: 'is',
      relation: 'owner',
      where: { op: 'never' },
    });
    expect(normalizeCondition({ owner: { is: undefined } })).toEqual({ op: 'never' });
  });

  test('a plain object without operator keys is a relation path and must end in quantifiers', () => {
    expect(() => normalizeCondition({ data: { a: 1 } })).toThrow(KeelwerkError);
    expect(() => normalizeCondition({ n: { gtee: 3 } })).toThrow(KeelwerkError);
    expect(() => normalizeCondition({ team: { members: {} } })).toThrow(KeelwerkError);
    expect(() => normalizeCondition({ team: { some: { a: 1 }, members: { some: {} } } })).toThrow(
      KeelwerkError,
    );
    expect(() => normalizeCondition({ team: { eq: 1, members: { some: { a: 1 } } } })).toThrow(
      KeelwerkError,
    );
  });

  test('an absent step in a relation path matches nothing; a wire null is malformed', () => {
    expect(normalizeCondition({ team: { members: undefined } })).toEqual({ op: 'never' });
    expect(() => normalizeWireFilter({ team: { members: null } })).toThrow(KeelwerkError);
  });

  test('a non-plain value is an eq value', () => {
    const set = new Set([1]);
    expect(normalizeCondition({ f: set })).toEqual({ op: 'eq', field: 'f', value: set });
    expect(normalizeCondition({ f: [1, 2] })).toEqual({ op: 'eq', field: 'f', value: [1, 2] });
  });

  test('malformed input is a validation error', () => {
    const bad: unknown[] = [
      { f: {} },
      { f: { eq: 1, bogus: 2 } },
      { f: { isNull: 'yes' } },
      { f: { in: 1 } },
      { and: {} },
      { and: [1] },
      { not: [] },
      { members: { some: 1 } },
    ];
    for (const input of bad) {
      expect(() => normalizeCondition(input as Record<string, unknown>)).toThrow(KeelwerkError);
    }
  });
});

describe('normalizeWireFilter', () => {
  test('a bare null is isNull true', () => {
    expect(normalizeWireFilter({ revokedAt: null })).toEqual({
      op: 'isNull',
      field: 'revokedAt',
      value: true,
    });
  });

  test('also inside and, or, not and relation conditions', () => {
    expect(
      normalizeWireFilter({ or: [{ a: null }], not: { b: null }, rel: { some: { c: null } } }),
    ).toEqual({
      op: 'and',
      conditions: [
        { op: 'or', conditions: [{ op: 'isNull', field: 'a', value: true }] },
        { op: 'not', condition: { op: 'isNull', field: 'b', value: true } },
        { op: 'some', relation: 'rel', where: { op: 'isNull', field: 'c', value: true } },
      ],
    });
  });

  test('operators keep the code semantics', () => {
    expect(normalizeWireFilter({ f: { eq: null } })).toEqual({ op: 'never' });
    expect(normalizeWireFilter({ f: { isNull: true } })).toEqual({
      op: 'isNull',
      field: 'f',
      value: true,
    });
  });

  test('anything but an object is rejected', () => {
    expect(() => normalizeWireFilter(null)).toThrow(KeelwerkError);
    expect(() => normalizeWireFilter([])).toThrow(KeelwerkError);
    expect(() => normalizeWireFilter('x')).toThrow(KeelwerkError);
  });
});

describe('conditionFields', () => {
  test('lists fields and relations once, in order', () => {
    const condition = normalizeCondition({
      b: 1,
      or: [{ a: { gt: 1 } }, { b: 2 }],
      not: { c: 1 },
      members: { some: { userId: 'x' } },
    });
    expect(conditionFields(condition)).toEqual({
      fields: ['b', 'a', 'c'],
      relations: ['members'],
      quantifiers: [
        { op: 'some', relation: 'members', where: { op: 'eq', field: 'userId', value: 'x' } },
      ],
    });
  });

  test('never names nothing', () => {
    expect(conditionFields({ op: 'never' })).toEqual({
      fields: [],
      relations: [],
      quantifiers: [],
    });
  });
});

describe('the bounds of the normaliser', () => {
  function refusal(run: () => unknown): KeelwerkError {
    try {
      run();
    } catch (failure) {
      if (failure instanceof KeelwerkError) return failure;
    }
    throw new Error('expected a KeelwerkError');
  }

  function nested(levels: number): Record<string, unknown> {
    let filter: Record<string, unknown> = { a: 1 };
    for (let level = 0; level < levels; level += 1) filter = { not: filter };
    return filter;
  }

  test('takes 32 levels and refuses 33 and 10 000, in code and on the wire', () => {
    expect(() => normalizeCondition(nested(32))).not.toThrow();
    for (const levels of [33, 10_000]) {
      const failure = refusal(() => normalizeCondition(nested(levels)));
      expect(failure.code).toBe('core.malformed_request');
      expect(failure.issues?.[0]?.message).toBe(
        'nests more than 32 levels of and, or, not and relations',
      );
      expect(refusal(() => normalizeWireFilter(nested(levels))).code).toBe(
        'core.malformed_request',
      );
    }
  });

  test('counts the segments of a dotted relation path as levels', () => {
    const key = Array<string>(40).fill('owner').join('.');
    expect(refusal(() => normalizeCondition({ [key]: { is: { a: 1 } } })).code).toBe(
      'core.malformed_request',
    );
  });

  test('refuses more than 10 000 members', () => {
    const many = (count: number): Record<string, unknown> => ({
      and: Array.from({ length: count }, () => ({ a: 1 })),
    });
    expect(() => normalizeCondition(many(4_000))).not.toThrow();
    const failure = refusal(() => normalizeCondition(many(10_001)));
    expect(failure.code).toBe('core.malformed_request');
    expect(failure.issues?.[0]?.message).toBe('holds more than 10000 members and items');
    const wide = { f: { in: Array.from({ length: 10_001 }, (_, index) => index) } };
    expect(refusal(() => normalizeCondition(wide)).code).toBe('core.malformed_request');
  });
});
