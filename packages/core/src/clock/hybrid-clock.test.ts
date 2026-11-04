import { describe, expect, it } from 'vitest';
import type { Hlc } from '../events/hlc.ts';
import { compareHlc } from './compare-hlc.ts';
import { hybridClock } from './hybrid-clock.ts';

const hlc = (text: string): Hlc => text as Hlc;

describe('hybridClock', () => {
  it('formats 12 hex digits of milliseconds, 4 of counter, a hyphen and the node id', () => {
    const clock = hybridClock('s7k2m9x4qa');
    expect(clock.tick(0x0192a3b4c5d6)).toBe('0192a3b4c5d60000-s7k2m9x4qa');
    expect(clock.tick(0x0192a3b4c5d6)).toBe('0192a3b4c5d60001-s7k2m9x4qa');
    expect(clock.tick(0x0192a3b4c5d7)).toBe('0192a3b4c5d70000-s7k2m9x4qa');
  });

  it('never moves back when the wall clock does', () => {
    const clock = hybridClock('sa');
    const first = clock.tick(1000);
    const second = clock.tick(900);
    expect(compareHlc(first, second)).toBe(-1);
    expect(second.slice(0, 12)).toBe(first.slice(0, 12));
  });

  it('moves to the next millisecond when the counter overflows', () => {
    const clock = hybridClock('sa');
    clock.tick(5000);
    for (let index = 1; index < 0xffff; index += 1) {
      clock.tick(5000);
    }
    expect(clock.tick(5000)).toBe(`${(5000).toString(16).padStart(12, '0')}ffff-sa`);
    expect(clock.tick(5000)).toBe(`${(5001).toString(16).padStart(12, '0')}0000-sa`);
  });

  it('applies the receive rule: the next reading exceeds every clock seen', () => {
    const clock = hybridClock('sa');
    clock.tick(1000);
    const remote = hlc('0000000007d10003-client9');
    clock.receive(remote);
    const next = clock.tick(1000);
    expect(compareHlc(remote, next)).toBe(-1);
    expect(next).toBe('0000000007d10004-sa');
    clock.receive(hlc('0000000000010000-old'));
    expect(clock.tick(1000)).toBe('0000000007d10005-sa');
  });

  it('refuses malformed input', () => {
    const clock = hybridClock('sa');
    expect(() => clock.receive(hlc('nope'))).toThrow(RangeError);
    expect(() => clock.tick(-1)).toThrow(RangeError);
    expect(() => clock.tick(1.5)).toThrow(RangeError);
    expect(() => clock.tick(2 ** 48)).toThrow(RangeError);
    expect(() => hybridClock('')).toThrow(RangeError);
  });
});

describe('compareHlc', () => {
  it('orders by the first 16 characters, then by node id', () => {
    expect(compareHlc(hlc('0000000000010000-a'), hlc('0000000000010001-a'))).toBe(-1);
    expect(compareHlc(hlc('0000000000020000-a'), hlc('0000000000010009-z'))).toBe(1);
    expect(compareHlc(hlc('0000000000010000-a'), hlc('0000000000010000-b'))).toBe(-1);
    expect(compareHlc(hlc('0000000000010000-b'), hlc('0000000000010000-a'))).toBe(1);
    expect(compareHlc(hlc('0000000000010000-a'), hlc('0000000000010000-a'))).toBe(0);
  });
});
