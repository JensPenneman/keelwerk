import { describe, expect, test } from 'vitest';
import { createVisibilitySet } from '../../src/hub/visibility-set.ts';

describe('the visibility set', () => {
  test('the bound marks the set partial and keeps its members exact', () => {
    const set = createVisibilitySet(2);
    expect(set.add('a')).toBe(true);
    expect(set.add('b')).toBe(true);
    expect(set.exact).toBe(true);
    expect(set.add('c')).toBe(false);
    expect(set.exact).toBe(false);
    expect(set.has('a')).toBe(true);
    expect(set.has('b')).toBe(true);
    expect(set.has('c')).toBe(false);
    // Room freed later does not make it exact again, and a member is still found.
    set.delete('a');
    expect(set.exact).toBe(false);
    expect(set.add('c')).toBe(true);
    expect(set.size).toBe(2);
  });

  test('an id already in the set is accepted even when the set is full', () => {
    const set = createVisibilitySet(1);
    set.add('a');
    expect(set.add('a')).toBe(true);
    expect(set.exact).toBe(true);
  });

  test('markPartial declares the set partial without a bound', () => {
    const set = createVisibilitySet(10);
    set.markPartial();
    expect(set.exact).toBe(false);
  });
});
