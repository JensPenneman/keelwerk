import canonicalize from 'canonicalize';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { canonicalizeJson } from './canonicalize-json.ts';

describe('canonicalizeJson', () => {
  it('matches the independent implementation on arbitrary JSON values', () => {
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        expect(canonicalizeJson(value)).toBe(canonicalize(value));
      }),
      { numRuns: 500 },
    );
  });

  it('matches it on unicode strings and keys', () => {
    fc.assert(
      fc.property(
        fc.dictionary(fc.string({ unit: 'binary' }), fc.string({ unit: 'binary' })),
        (value) => {
          expect(canonicalizeJson(value)).toBe(canonicalize(value));
        },
      ),
      { numRuns: 300 },
    );
  });

  it('reproduces the examples of RFC 8785', () => {
    expect(
      canonicalizeJson({
        b: 1,
        a: [1e30, 4.5, 2e-3, 0.000000000000000000000000001],
        '\u20ac': 'x',
        '\r': 'y',
      }),
    ).toBe('{"\\r":"y","a":[1e+30,4.5,0.002,1e-27],"b":1,"\u20ac":"x"}');
    expect(canonicalizeJson({ '\u{1F600}': 1, '\uFB33': 2 })).toBe('{"\u{1F600}":1,"\uFB33":2}');
    expect(canonicalizeJson(-0)).toBe('0');
    expect(canonicalizeJson(333333333.3333333)).toBe('333333333.3333333');
  });

  it('drops undefined members, nulls undefined items and rejects what has no JSON form', () => {
    expect(canonicalizeJson({ a: undefined, b: [undefined, 1] })).toBe('{"b":[null,1]}');
    expect(() => canonicalizeJson(undefined)).toThrow(TypeError);
    expect(() => canonicalizeJson(Number.NaN)).toThrow(TypeError);
    expect(() => canonicalizeJson({ a: Number.POSITIVE_INFINITY })).toThrow(TypeError);
    expect(() => canonicalizeJson(1n)).toThrow(TypeError);
    expect(() => canonicalizeJson('\ud800')).toThrow(TypeError);
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    expect(() => canonicalizeJson(cycle)).toThrow(TypeError);
  });

  it('serialises dates, Temporal values and boxed primitives through toJSON as the reference does', () => {
    fc.assert(
      fc.property(fc.date(), (at) => {
        expect(canonicalizeJson({ at, list: [at] })).toBe(canonicalize({ at, list: [at] }));
      }),
      { numRuns: 200 },
    );
    const instant = Temporal.Instant.from('2026-11-04T10:00:00.123Z');
    expect(canonicalizeJson({ at: instant })).toBe('{"at":"2026-11-04T10:00:00.123Z"}');
    expect(canonicalizeJson({ at: instant })).toBe(canonicalize({ at: instant }));
    expect(canonicalizeJson({ n: new Number(3), s: new String('x'), b: new Boolean(false) })).toBe(
      '{"b":false,"n":3,"s":"x"}',
    );
  });

  it('passes the member key to toJSON', () => {
    const keyed = Object.fromEntries([['toJSON', (key: string) => `key:${key}`]]);
    expect(canonicalizeJson({ a: keyed, list: [keyed] })).toBe('{"a":"key:a","list":["key:0"]}');
  });

  it('accepts a shared, non-cyclic reference twice', () => {
    const shared = { x: 1 };
    expect(canonicalizeJson([shared, shared])).toBe('[{"x":1},{"x":1}]');
  });
});
