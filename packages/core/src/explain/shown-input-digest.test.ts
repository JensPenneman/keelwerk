import { describe, expect, test } from 'vitest';
import { shownInputDigest } from './shown-input-digest.ts';

const hex = 'a'.repeat(64);

describe('shownInputDigest', () => {
  test('a decision base, a rekeyed decision digest and a reaction digest are shown', () => {
    expect(shownInputDigest(`kwb1.${hex}`)).toBe(`kwb1.${hex}`);
    expect(shownInputDigest(`kwd1.${hex}`)).toBe(`kwd1.${hex}`);
    expect(shownInputDigest(`kwr1.${hex}`)).toBe(`kwr1.${hex}`);
  });

  test('the 0.1.0 form, erased, a receipt fingerprint and anything else are withheld', () => {
    for (const digest of [
      hex,
      'erased',
      `kwf1.${hex}`,
      'd',
      `kwb1.${'a'.repeat(63)}`,
      `kwb1.${hex}0`,
    ]) {
      expect(shownInputDigest(digest)).toBe('withheld');
    }
  });
});
