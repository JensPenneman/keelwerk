import { describe, expect, test } from 'vitest';
import { capabilitySetsOf } from './capability-sets-of.ts';

describe('capabilitySetsOf', () => {
  test('answers every subset as a sorted, comma-joined lane text, the empty set first', () => {
    expect(capabilitySetsOf(['smtp-out', 'gpu'])).toEqual(['', 'gpu', 'gpu,smtp-out', 'smtp-out']);
  });

  test('is independent of the order and of duplicates, and a process with none takes only the empty lane', () => {
    expect(capabilitySetsOf(['gpu', 'smtp-out', 'gpu'])).toEqual(
      capabilitySetsOf(['smtp-out', 'gpu']),
    );
    expect(capabilitySetsOf([])).toEqual(['']);
  });

  test('refuses more than ten distinct capabilities', () => {
    const ten = Array.from({ length: 10 }, (_, index) => `c${index}`);
    expect(capabilitySetsOf(ten)).toHaveLength(1024);
    expect(() => capabilitySetsOf([...ten, 'c10'])).toThrow(
      expect.objectContaining({ kind: 'unsupported' }),
    );
  });
});
