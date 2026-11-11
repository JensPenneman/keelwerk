import { describe, expect, test } from 'vitest';
import { flagSlotOf } from './flag-slot-of.ts';

describe('flagSlotOf', () => {
  test('golden vectors fix the two stored slot forms', () => {
    expect(flagSlotOf('library.newFlow', null)).toBe('library.newFlow');
    expect(flagSlotOf('library.newFlow', '6f1c2a4e-0000-4000-8000-000000000001')).toBe(
      'library.newFlow@6f1c2a4e-0000-4000-8000-000000000001',
    );
  });
});
