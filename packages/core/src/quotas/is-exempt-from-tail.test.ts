import { describe, expect, test } from 'vitest';
import { isExemptFromTail } from './is-exempt-from-tail.ts';

describe('isExemptFromTail', () => {
  test('exempts the actions of the core module, per action', () => {
    expect(isExemptFromTail({ module: 'core' }, false)).toBe(true);
    expect(isExemptFromTail({ module: 'coreish' }, false)).toBe(false);
  });

  test('exempts every action of a unit that is exempt, whatever the action is', () => {
    expect(isExemptFromTail({ module: 'library' }, true)).toBe(true);
    expect(isExemptFromTail({ module: 'library' }, false)).toBe(false);
  });
});
