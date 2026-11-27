import { describe, expect, test } from 'vitest';
import type { EffectAttemptError } from '../effects/effect-attempt-error.ts';
import { outcomeUnknown } from './outcome-unknown.ts';

const projection = (code: string) => ({ code }) as EffectAttemptError;
const timeout = projection('core.timeout');

describe('outcomeUnknown', () => {
  test('a timeout that the policy does not run again leaves the outcome unknown', () => {
    expect(outcomeUnknown(false, timeout, false, false, false)).toBe(true);
  });

  test('a timeout that is retried, and any other failure, leave it known', () => {
    expect(outcomeUnknown(false, timeout, true, false, false)).toBe(false);
    expect(outcomeUnknown(false, projection('core.validation'), false, false, false)).toBe(false);
  });

  test('a timeout that fired before any executor of the effect was called reached nothing: the outcome is known', () => {
    expect(outcomeUnknown(false, timeout, false, true, false)).toBe(false);
  });

  test('a timeout that fired before its own executor was called leaves it unknown when an earlier attempt began', () => {
    expect(outcomeUnknown(false, timeout, false, true, true)).toBe(true);
  });

  test('an executor that returned and an answer the kernel could not take leave it unknown whatever else holds', () => {
    expect(outcomeUnknown(true, projection('core.internal'), true, false, false)).toBe(true);
    expect(outcomeUnknown(true, timeout, false, true, false)).toBe(true);
  });
});
