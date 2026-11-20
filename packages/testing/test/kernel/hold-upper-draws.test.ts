import { afterEach, describe, expect, test } from 'vitest';
import { holdUpperDraws } from './support/hold-upper-draws.ts';

const original = Math.random;
const highest = 1 - Number.EPSILON / 2;

afterEach(() => {
  Math.random = original;
});

describe('holdUpperDraws', () => {
  test('draws stay in [0.5, 1) while held and the source comes back at the last release', () => {
    const answers = [0, 0.5, highest, 1 - Number.EPSILON];
    let next = 0;
    const source = () => answers[next++] ?? 0;
    Math.random = source;
    const release = holdUpperDraws();
    try {
      expect(Math.random()).toBe(0.5);
      expect(Math.random()).toBe(0.75);
      // The clamp keeps the largest draw below 1: 0.5 + s / 2 rounds the third source, 1 - Number.EPSILON / 2, the engine's largest draw, up to exactly 1; the fourth, 1 - Number.EPSILON, maps to the same value without rounding.
      const nearTop = Math.random();
      const top = Math.random();
      expect(nearTop).toBe(highest);
      expect(top).toBe(highest);
      expect(nearTop).toBeLessThan(1);
      expect(top).toBeLessThan(1);
    } finally {
      release();
    }
    expect(Math.random).toBe(source);
  });

  test('a second holder does not wrap twice, and a release acts once', () => {
    const source = () => 0;
    Math.random = source;
    const first = holdUpperDraws();
    const second = holdUpperDraws();
    try {
      expect(Math.random()).toBe(0.5);
      first();
      first();
      expect(Math.random()).toBe(0.5);
      expect(Math.random).not.toBe(source);
      second();
      expect(Math.random).toBe(source);
    } finally {
      // A failed expectation must not leave a holder behind for the next case; a release acts once.
      first();
      second();
    }
  });

  test('a retry delay under the held draws is never zero and never above the policy', () => {
    // The kernel's job delay is floor(draw * (delay + 1)) (retry-delay.ts:32); @keelwerk/core does not
    // export retryDelay, so the formula is repeated here for the bound only.
    const delayOf = (policyMs: number) => Math.floor(Math.random() * (policyMs + 1));
    // Only the `highest` row pins the clamp: without it that draw gives policyMs + 1.
    for (const policyMs of [1, 10_000, 20_000, 40_000]) {
      for (const [draw, expected] of [
        [0, Math.ceil(policyMs / 2)],
        [highest, policyMs],
        [1 - Number.EPSILON, policyMs],
      ] as const) {
        Math.random = () => draw;
        const release = holdUpperDraws();
        try {
          expect(delayOf(policyMs)).toBe(expected);
        } finally {
          release();
        }
      }
    }
  });
});
