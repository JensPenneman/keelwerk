import { describe, expect, test } from 'vitest';
import type { ActionEntry } from '../registry/action-entry.ts';
import { isExemptFromAdmission } from './is-exempt-from-admission.ts';

describe('isExemptFromAdmission', () => {
  test('exempts the actions of the core module and no other', () => {
    expect(isExemptFromAdmission({ module: 'core' })).toBe(true);
    expect(isExemptFromAdmission({ module: 'library' })).toBe(false);
    expect(isExemptFromAdmission({ module: 'coreish' })).toBe(false);
  });

  test('does not exempt an action for its prepare step', () => {
    const prepare = (() => []) as never as NonNullable<ActionEntry['prepare']>;
    const action = { module: 'library', prepare };
    expect(isExemptFromAdmission(action)).toBe(false);
  });
});
