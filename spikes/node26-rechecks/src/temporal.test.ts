import { expect, test } from 'vitest';
import { runNode } from './run-node.ts';

const script = `
const instant = Temporal.Instant.from('2026-11-04T10:20:30.123987654Z');
const rounded = instant.round({ smallestUnit: 'millisecond', roundingMode: 'floor' });
console.log(JSON.stringify({
  native: typeof Temporal === 'object' && typeof Temporal.Instant === 'function',
  rounded: rounded.toString(),
  ms: rounded.epochMilliseconds,
  roundTrip: Temporal.Instant.fromEpochMilliseconds(rounded.epochMilliseconds).equals(rounded),
  precision: instant.toString({ fractionalSecondDigits: 3 }),
}));
`;

test('Temporal.Instant is native and rounds down to milliseconds', () => {
  const run = runNode(['--input-type=module', '--eval', script]);
  expect(run.stderr).toBe('');
  expect(run.status).toBe(0);
  expect(JSON.parse(run.stdout)).toEqual({
    native: true,
    rounded: '2026-11-04T10:20:30.123Z',
    ms: Date.UTC(2026, 10, 4, 10, 20, 30, 123),
    roundTrip: true,
    precision: '2026-11-04T10:20:30.123Z',
  });
});
