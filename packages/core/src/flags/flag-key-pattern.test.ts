import { describe, expect, test } from 'vitest';
import { set } from '../core-module/actions/flag/set.ts';
import type { StandardSchemaV1 } from '../fields/standard-schema-v1.ts';
import { flagKeyPattern } from './flag-key-pattern.ts';

const input = (set.spec as { readonly input: StandardSchemaV1 }).input;
const check = (key: string) =>
  input['~standard'].validate({
    key,
    targeting: { enabled: true, rules: [], fallthrough: { value: true } },
    reason: 'x',
  });

describe('flagKeyPattern', () => {
  test('takes a module id and a flag name', () => {
    for (const key of ['shop.checkout', 'mail-queue.sendLimit', 'core.flag.x1']) {
      expect(flagKeyPattern.test(key)).toBe(true);
    }
  });

  test('refuses a key with @, a missing flag name, or characters outside the grammar', () => {
    for (const key of [
      'shop.beta@6b1f',
      '@shop.beta',
      'shop',
      'Shop.beta',
      'shop.Beta',
      'shop..beta',
      'shop.beta.',
      'shop beta',
      'shop.be_ta',
    ]) {
      expect(flagKeyPattern.test(key)).toBe(false);
    }
  });
});

describe('the key of core.flag.set', () => {
  test('holds the pattern, so no key can read as the slot of a backend row', () => {
    expect(check('shop.beta')).not.toHaveProperty('issues');
    for (const key of ['shop.beta@6b1f', 'shop.be ta', 'beta']) {
      expect(check(key)).toHaveProperty('issues');
    }
  });
});
