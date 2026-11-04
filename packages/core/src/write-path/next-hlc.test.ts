import { expect, test } from 'vitest';
import { defaultNodeId } from './default-node-id.ts';
import { nextHlc } from './next-hlc.ts';

test('a reading is 12 hex digits of milliseconds, 4 of counter, a hyphen and the node id', () => {
  const at = Temporal.Instant.fromEpochMilliseconds(0x0192a3b4c5d6);
  expect(nextHlc(at, 1, 's7k2m9x4qa')).toBe('0192a3b4c5d60001-s7k2m9x4qa');
  expect(nextHlc(at, 0xffff, defaultNodeId)).toBe('0192a3b4c5d6ffff-s0000000000');
});

test('readings sort as text in the order they were taken', () => {
  const at = Temporal.Instant.fromEpochMilliseconds(1_800_000_000_000);
  const readings = [0, 1, 9, 10, 255, 256].map((n) => nextHlc(at, n, defaultNodeId));
  expect([...readings].sort()).toEqual(readings);
});

test('a counter beyond four digits fails the command', () => {
  expect(() => nextHlc(Temporal.Instant.fromEpochMilliseconds(0), 0x10000, defaultNodeId)).toThrow(
    /65536 events/,
  );
});
