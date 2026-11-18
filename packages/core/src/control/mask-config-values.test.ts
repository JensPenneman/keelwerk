import { describe, expect, test } from 'vitest';
import { maskConfigValues } from './mask-config-values.ts';

const marker = 'kw:withheld';

describe('maskConfigValues', () => {
  test('every member value of every module object is withheld; ids and names stay', () => {
    const input = { name: 'acme', config: { mail: { host: 'h', apiKey: 'k' }, other: { a: 1 } } };
    expect(maskConfigValues(input)).toEqual({
      name: 'acme',
      config: { mail: { host: marker, apiKey: marker }, other: { a: marker } },
    });
    expect(input.config.mail.apiKey).toBe('k');
  });

  test('a module value that is no plain object is replaced whole', () => {
    expect(maskConfigValues({ config: { mail: 'x', list: ['a'], nothing: null } })).toEqual({
      config: { mail: marker, list: marker, nothing: marker },
    });
  });

  test('an input without config, or no object at all, is answered as it is', () => {
    const plain = { name: 'acme' };
    expect(maskConfigValues(plain)).toBe(plain);
    expect(maskConfigValues(null)).toBeNull();
    expect(maskConfigValues('x')).toBe('x');
    const none = { name: 'acme', config: undefined };
    expect(maskConfigValues(none)).toBe(none);
  });

  test('a config that is no object is withheld whole', () => {
    expect(maskConfigValues({ name: 'acme', config: 'oops' })).toEqual({
      name: 'acme',
      config: marker,
    });
  });
});
