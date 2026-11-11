import { describe, expect, test } from 'vitest';
import { extensionPoint } from './extension-point.ts';

describe('extensionPoint.single', () => {
  test('a single point refuses min 2', () => {
    // @ts-expect-error a single point takes min 0 or 1 only
    expect(() => extensionPoint.single<number>({ min: 2 })).toThrow(/min 0 or 1/);
  });

  test('a single point takes min 0 and min 1', () => {
    expect(extensionPoint.single<number>({ min: 0 }).options).toEqual({ min: 0 });
    expect(extensionPoint.single<number>({ min: 1 }).options).toEqual({ min: 1 });
    expect(extensionPoint.single<number>().options).toEqual({});
  });
});
