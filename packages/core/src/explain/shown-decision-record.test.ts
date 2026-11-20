import { expect, test } from 'vitest';
import type { EncodedDecisionRecord } from '../events/encode-decision-record.ts';
import { shownDecisionRecord } from './shown-decision-record.ts';

const base: EncodedDecisionRecord = {
  part: 'p',
  inputDigest: `kwb1.${'a'.repeat(64)}`,
  reads: [],
  answers: [],
  effects: [],
};

test('the prepare member is shown as stored', () => {
  const prepare = { reads: [{ at: '7' }], answers: [], effects: ['e-1'] };
  const shown = shownDecisionRecord({ ...base, prepare });
  expect(shown.prepare).toEqual(prepare);
  expect(shown.inputDigest).toBe(base.inputDigest);
});

test('a record without a prepare member stays without one', () => {
  expect('prepare' in shownDecisionRecord(base)).toBe(false);
});
