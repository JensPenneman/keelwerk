import { describe, expect, test } from 'vitest';
import { caseless } from './caseless.ts';
import { email } from './email.ts';
import { exact } from './exact.ts';
import { nfc } from './nfc.ts';

describe('the email normaliser (14.7.9.3)', () => {
  test('differently cased addresses are one value', () => {
    expect(email('Jens@JensPenneman.com')).toBe(email('jens@jenspenneman.com'));
    expect(email('Jens@JensPenneman.com')).toBe('jens@jenspenneman.com');
  });

  test('trims, composes and puts the domain through punycode', () => {
    expect(email('  Ada@Exámple.org \n')).toBe('ada@xn--exmple-qta.org');
    expect(email('a@bücher.example')).toBe('a@xn--bcher-kva.example');
    expect(email('a@BÜCHER.example')).toBe('a@xn--bcher-kva.example');
  });

  test('a text without an at sign is trimmed, composed and lower-cased', () => {
    expect(email('  PLAIN ')).toBe('plain');
  });

  test('the last at sign starts the domain', () => {
    expect(email('"a@b"@Example.COM')).toBe('"a@b"@example.com');
  });

  test('a domain the IDNA rules reject stays as written, lower-cased', () => {
    expect(email('x@Bad Domain.example')).toBe('x@bad domain.example');
  });
});

describe('the other normalisers (14.7.9.3)', () => {
  test('exact keeps the text as written', () => {
    expect(exact('Jens ')).toBe('Jens ');
  });

  test('nfc makes a composed and a decomposed letter equal', () => {
    expect(nfc('é')).toBe(nfc('é'));
    expect(nfc('Jens')).toBe('Jens');
  });

  test('caseless folds compatibility forms and case without a locale', () => {
    expect(caseless('ﬁLe')).toBe('file');
    expect(caseless('I')).toBe('i');
    expect(caseless('ẞİ')).toBe(caseless('ẞİ'));
  });
});
