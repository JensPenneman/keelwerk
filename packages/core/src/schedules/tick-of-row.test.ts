import { expect, test } from 'vitest';
import { tickOfRow } from './tick-of-row.ts';

const T0 = Temporal.Instant.from('2026-01-01T00:00:00Z');

test('a row on the grid is its own tick', () => {
  expect(tickOfRow('5m', T0.add({ minutes: 10 })).toString()).toBe('2026-01-01T00:10:00Z');
});

test('a row off the grid stands for the grid point before it', () => {
  expect(tickOfRow('1d', T0.add({ seconds: 62 })).toString()).toBe('2026-01-01T00:00:00Z');
  expect(tickOfRow('5m', T0.add({ minutes: 6, milliseconds: 1 })).toString()).toBe(
    '2026-01-01T00:05:00Z',
  );
});

test('an unparsable or zero every is validation', () => {
  expect(() => tickOfRow('soon', T0)).toThrow(expect.objectContaining({ kind: 'validation' }));
  expect(() => tickOfRow('0s', T0)).toThrow(expect.objectContaining({ kind: 'validation' }));
});
