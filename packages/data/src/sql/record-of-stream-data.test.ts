import { describe, expect, test } from 'vitest';
import { recordOfStreamData } from './record-of-stream-data.ts';

describe('the envelope of a stored stream record', () => {
  test('golden: { record } and { record, v: 2 } decode to the same record', () => {
    const record = { line: 'a', n: 1 };
    expect(recordOfStreamData({ record })).toEqual(record);
    expect(recordOfStreamData({ record, v: 2 })).toEqual(record);
    expect(recordOfStreamData(JSON.stringify({ record, v: 2 }))).toEqual(record);
  });

  test('every other envelope is refused', () => {
    for (const data of [
      { record: {}, extra: 1 },
      { record: {}, v: 0 },
      { record: {}, v: 1.5 },
      { record: {}, v: '2' },
      { offload: 'x' },
      { v: 2 },
      [],
      null,
      'not json',
    ]) {
      expect(() => recordOfStreamData(data)).toThrow();
    }
  });
});
