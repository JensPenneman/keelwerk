import { describe, expect, test } from 'vitest';
import { versionProjection } from './version-projection.ts';

describe('versionProjection', () => {
  test('builds each version once at first use', () => {
    const built: string[] = [];
    const projection = versionProjection(['2026-11-04', '2026-11-11'], (version) => {
      built.push(version);
      return { version };
    });
    expect(projection.versions).toEqual(['2026-11-04', '2026-11-11']);
    expect(built).toEqual([]);
    const first = projection.at('2026-11-11');
    expect(projection.at('2026-11-11')).toBe(first);
    expect(built).toEqual(['2026-11-11']);
    projection.at('2026-11-04');
    expect(built).toEqual(['2026-11-11', '2026-11-04']);
  });

  test('an undeclared version throws', () => {
    const projection = versionProjection(['2026-11-04'], () => 1);
    expect(() => projection.at('2026-12-01')).toThrow(RangeError);
  });
});
