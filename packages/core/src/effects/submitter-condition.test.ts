import { describe, expect, test } from 'vitest';
import { evaluateCondition } from '../conditions/evaluate-condition.ts';
import { submitterCondition } from './submitter-condition.ts';

const requested = { id: 'e1', principalResolver: 'auth.session', principalId: 's1' };
const unsubmitted = { id: 'e2', principalResolver: null, principalId: null };

describe('submitterCondition', () => {
  test.each([
    ['null', { ref: null }],
    ['absent', {}],
    ['undefined', { ref: undefined }],
  ])('a principal without a reference matches no row (ref %s)', (_name, principal) => {
    const condition = submitterCondition(principal);
    expect(evaluateCondition(condition, requested)).toBe(false);
    expect(evaluateCondition(condition, unsubmitted)).toBe(false);
  });

  test('a row requested without a submitter matches no principal', () => {
    for (const ref of [
      { resolver: 'auth.session', principalId: 's1' },
      { resolver: '', principalId: '' },
    ]) {
      expect(evaluateCondition(submitterCondition({ ref }), unsubmitted)).toBe(false);
    }
    expect(
      evaluateCondition(submitterCondition({ ref: { resolver: 'a', principalId: 'b' } }), {}),
    ).toBe(false);
  });

  test('the same resolver and principal id match; another id or another resolver does not', () => {
    const own = submitterCondition({ ref: { resolver: 'auth.session', principalId: 's1' } });
    expect(evaluateCondition(own, requested)).toBe(true);
    expect(evaluateCondition(own, { ...requested, principalId: 's2' })).toBe(false);
    expect(evaluateCondition(own, { ...requested, principalResolver: 'auth.apiKey' })).toBe(false);
  });

  test('two sessions of one person are two references', () => {
    const first = submitterCondition({
      ref: { resolver: 'auth.session', principalId: 'session-1' },
    });
    const second = submitterCondition({
      ref: { resolver: 'auth.session', principalId: 'session-2' },
    });
    const row = { principalResolver: 'auth.session', principalId: 'session-1' };
    expect(evaluateCondition(first, row)).toBe(true);
    expect(evaluateCondition(second, row)).toBe(false);
  });
});
