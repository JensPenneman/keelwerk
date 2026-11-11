import { describe, expect, test } from 'vitest';
import { effectJobError } from './effect-job-error.ts';

const base = {
  kind: 'unavailable',
  retryable: false,
  requestId: '0198a1e0-0000-7000-8000-0000000000a1',
} as const;

describe('effectJobError', () => {
  test('a core code too has the fixed text naming the code, not its registered message', () => {
    expect(effectJobError({ ...base, code: 'core.effect_outcome_unknown' })).toEqual({
      ...base,
      code: 'core.effect_outcome_unknown',
      message: 'The effect failed with core.effect_outcome_unknown.',
    });
    expect(effectJobError({ ...base, kind: 'validation', code: 'core.validation' }).message).toBe(
      'The effect failed with core.validation.',
    );
  });

  test('any other code has the fixed text naming the code, and nothing else is added', () => {
    const wire = effectJobError({ ...base, retryAfter: 5, code: 'mail.rejected' });
    expect(wire).toEqual({
      ...base,
      retryAfter: 5,
      code: 'mail.rejected',
      message: 'The effect failed with mail.rejected.',
    });
    expect(Object.keys(wire)).not.toContain('details');
  });
});
