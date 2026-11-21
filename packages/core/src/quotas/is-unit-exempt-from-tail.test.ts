import { describe, expect, test } from 'vitest';
import type { ActionEntry } from '../registry/action-entry.ts';
import { isUnitExemptFromTail } from './is-unit-exempt-from-tail.ts';

const prepare = (() => []) as never as NonNullable<ActionEntry['prepare']>;

describe('isUnitExemptFromTail', () => {
  test('exempts the unit of a command that declares prepare and no other', () => {
    expect(isUnitExemptFromTail({ prepare })).toBe(true);
    expect(isUnitExemptFromTail({})).toBe(false);
  });
});
