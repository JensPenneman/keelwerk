import { describe, expect, test } from 'vitest';
import { field } from '../fields/field.ts';
import { shape } from '../fields/shape.ts';
import { moduleConfigOf } from './module-config-of.ts';

const shapes = new Map([['knobs', shape({ greeting: field.string().default('hello') })]]);
const required = new Map([['needy', shape({ endpoint: field.string() })]]);
const asynchronous = new Map([
  [
    'slow',
    {
      '~standard': {
        version: 1,
        vendor: 'test',
        validate: () => Promise.resolve({ value: {} }),
      },
    } as never,
  ],
]);

describe('moduleConfigOf', () => {
  test('answers the stored values over the defaults, and nothing for a module without a shape', () => {
    const config = moduleConfigOf(shapes, { knobs: { greeting: 'hi' } });
    expect(config('knobs')).toEqual({ greeting: 'hi' });
    expect(moduleConfigOf(shapes, undefined)('knobs')).toEqual({ greeting: 'hello' });
    expect(config('other')).toBeUndefined();
  });

  test('stored values the shape rejects are internal and name the module, never returned raw', () => {
    const config = moduleConfigOf(shapes, { knobs: { greeting: 42 } });
    expect(() => config('knobs')).toThrow(/"knobs"/);
    expect(() => config('knobs')).toThrow(expect.objectContaining({ kind: 'internal' }));
  });

  test('a module with nothing stored whose shape has required fields is internal: creation guarantees completeness (S-107)', () => {
    expect(() => moduleConfigOf(required, undefined)('needy')).toThrow(
      expect.objectContaining({ kind: 'internal' }),
    );
    expect(() => moduleConfigOf(required, { needy: {} })('needy')).toThrow(
      expect.objectContaining({ kind: 'internal' }),
    );
  });

  test('an asynchronous config shape is internal', () => {
    const config = moduleConfigOf(asynchronous, {});
    expect(() => config('slow')).toThrow(expect.objectContaining({ kind: 'internal' }));
  });
});
