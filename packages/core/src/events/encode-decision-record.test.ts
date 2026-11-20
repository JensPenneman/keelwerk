import { expect, test } from 'vitest';
import { buildDecisionRecord } from './build-decision-record.ts';
import { encodeDecisionRecord } from './encode-decision-record.ts';
import type { PrepareRecord } from './prepare-record.ts';

const base = {
  part: 'hooks.testEndpoint',
  inputDigest: 'kwb1.abc',
  reads: [{ at: 7n }],
  answers: [],
  effects: ['0192a3b4-c5d6-7000-8000-0000000000ee'],
};

const prepare: PrepareRecord = {
  reads: [{ scope: 'backend', at: 18446744073709551615n }],
  answers: [{ kind: 'id', entity: 'library.book', value: '0192a3b4-c5d6-7000-8000-0000000000aa' }],
  effects: ['0192a3b4-c5d6-7000-8000-0000000000bb'],
};

test('a record without prepare encodes exactly as before', () => {
  expect(JSON.stringify(encodeDecisionRecord(buildDecisionRecord(base)))).toBe(
    '{"part":"hooks.testEndpoint","inputDigest":"kwb1.abc","reads":[{"at":"7"}],"answers":[],"effects":["0192a3b4-c5d6-7000-8000-0000000000ee"]}',
  );
});

test('the prepare member encodes its reads as decimal text and keeps answers and ids', () => {
  expect(JSON.stringify(encodeDecisionRecord(buildDecisionRecord({ ...base, prepare })))).toBe(
    '{"part":"hooks.testEndpoint","inputDigest":"kwb1.abc","reads":[{"at":"7"}],"answers":[],"effects":["0192a3b4-c5d6-7000-8000-0000000000ee"],"prepare":{"reads":[{"scope":"backend","at":"18446744073709551615"}],"answers":[{"kind":"id","entity":"library.book","value":"0192a3b4-c5d6-7000-8000-0000000000aa"}],"effects":["0192a3b4-c5d6-7000-8000-0000000000bb"]}}',
  );
});

test('buildDecisionRecord copies the prepare lists and leaves the member out when absent', () => {
  const lists = { reads: [{ at: 1n }], answers: [], effects: ['x'] };
  const record = buildDecisionRecord({ ...base, prepare: lists });
  lists.reads.push({ at: 2n });
  lists.effects.push('y');
  expect(record.prepare?.reads).toEqual([{ at: 1n }]);
  expect(record.prepare?.effects).toEqual(['x']);
  expect('prepare' in buildDecisionRecord(base)).toBe(false);
});
