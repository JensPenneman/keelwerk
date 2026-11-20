import { expect, test } from 'vitest';
import { mergedRequestReads } from './merged-request-reads.ts';

test('the members prepare and decide read are one record', () => {
  expect(mergedRequestReads({ transport: 'rest' }, { userAgent: 'curl' })).toEqual({
    transport: 'rest',
    userAgent: 'curl',
  });
  expect(mergedRequestReads(undefined, { userAgent: null })).toEqual({ userAgent: null });
  expect(mergedRequestReads({ transport: 'rest' }, undefined)).toEqual({ transport: 'rest' });
  expect(mergedRequestReads(undefined, undefined)).toBeUndefined();
});
