import { describe, expect, test } from 'vitest';
import type { EffectAttemptRecord } from '../effects/effect-attempt-record.ts';
import { abandonOnLostLease } from './abandon-on-lost-lease.ts';

const start = (attempt: number): EffectAttemptRecord => ({
  process: 'p',
  build: 'b',
  attempt,
  startedAt: '2026-11-11T10:00:00Z',
});
const end = (attempt: number): EffectAttemptRecord => ({
  ...start(attempt),
  endedAt: '2026-11-11T10:00:01Z',
});

describe('abandonOnLostLease', () => {
  test('a start record of attempt 1 with no end is open at attempt 2', () => {
    expect(abandonOnLostLease([start(1)], 2)).toEqual({ started: 1, open: 1 });
  });

  test('a start and an end record close the attempt; both records count as one started attempt', () => {
    expect(abandonOnLostLease([start(1), end(1)], 2)).toEqual({ started: 1, open: undefined });
  });

  test('no record at all means no attempt started and none is open', () => {
    expect(abandonOnLostLease([], 1)).toEqual({ started: 0, open: undefined });
  });

  test('an open start record that has the current attempt number is open too: the job was handed out again under the same number', () => {
    expect(abandonOnLostLease([start(2)], 2)).toEqual({ started: 1, open: 2 });
    expect(abandonOnLostLease([start(2), end(2)], 2)).toEqual({ started: 1, open: undefined });
  });

  test('later attempts are ignored for the open check, and the first open one is named', () => {
    expect(abandonOnLostLease([start(3)], 2)).toEqual({ started: 1, open: undefined });
    expect(abandonOnLostLease([start(1), end(1), start(2), start(3)], 4)).toEqual({
      started: 3,
      open: 2,
    });
  });
});
