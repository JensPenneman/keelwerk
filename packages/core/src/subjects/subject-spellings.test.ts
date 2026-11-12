import { describe, expect, test } from 'vitest';
import { canonicalSubject } from './canonical-subject.ts';
import { erasureKey } from './erasure-key.ts';
import { sameSubject } from './same-subject.ts';
import { subjectNeedsLowerCase } from './subject-needs-lower-case.ts';
import { subjectSpellings } from './subject-spellings.ts';

const compact = '0f1f2f3f4f5f6f7f8f9fafbfcfdfefff';
const hyphenated = '0f1f2f3f-4f5f-6f7f-8f9f-afbfcfdfefff';

describe('the spellings of a data subject', () => {
  test('the canonical form of a 128-bit text is the lower-case hyphenated UUID, any text else is unchanged', () => {
    expect(canonicalSubject(compact)).toBe(hyphenated);
    expect(canonicalSubject(compact.toUpperCase())).toBe(hyphenated);
    expect(canonicalSubject(hyphenated.toUpperCase())).toBe(hyphenated);
    expect(canonicalSubject(hyphenated)).toBe(hyphenated);
    expect(canonicalSubject('ada')).toBe('ada');
    expect(canonicalSubject(`${compact}0`)).toBe(`${compact}0`);
  });

  test('a subject has four stored spellings, the canonical one first', () => {
    const upper = hyphenated.toUpperCase();
    const expected = [hyphenated, compact, upper, compact.toUpperCase()];
    for (const text of [compact, hyphenated, upper, compact.toUpperCase()]) {
      expect(subjectSpellings(text)).toEqual(expected);
    }
  });

  test('a text that is no 128-bit value is its own only spelling', () => {
    expect(subjectSpellings('jan@example.com')).toEqual(['jan@example.com']);
    expect(subjectSpellings('ada')).toEqual(['ada']);
  });

  test('two spellings of one value are the same subject in any case, other values are not', () => {
    expect(sameSubject(compact, hyphenated)).toBe(true);
    expect(sameSubject(hyphenated, compact)).toBe(true);
    expect(sameSubject(compact, compact)).toBe(true);
    expect(sameSubject(compact.toUpperCase(), hyphenated)).toBe(true);
    expect(sameSubject(hyphenated.toUpperCase(), compact)).toBe(true);
    expect(sameSubject(compact, `${compact.slice(0, 31)}0`)).toBe(false);
    expect(sameSubject(undefined, compact)).toBe(false);
    expect(sameSubject('ada', 'ada')).toBe(true);
    expect(sameSubject('ada', 'ADA')).toBe(false);
  });

  test('only a 128-bit value in upper or mixed case needs the lower case', () => {
    expect(subjectNeedsLowerCase(compact)).toBe(false);
    expect(subjectNeedsLowerCase(hyphenated)).toBe(false);
    expect(subjectNeedsLowerCase(compact.toUpperCase())).toBe(true);
    expect(subjectNeedsLowerCase(hyphenated.toUpperCase())).toBe(true);
    expect(subjectNeedsLowerCase(`0F1F2F3F-${hyphenated.slice(9)}`)).toBe(true);
    expect(subjectNeedsLowerCase('Ada')).toBe(false);
  });

  test('one erasure has one identity under every spelling of its subject', () => {
    const tenantId = '0192f3a0-0000-7000-8000-000000000001';
    const commandId = '0192f3a0-0000-7000-8000-0000000000c1';
    const key = erasureKey({ tenantId, commandId, subjectId: hyphenated });
    expect(erasureKey({ tenantId, commandId, subjectId: compact })).toBe(key);
    expect(erasureKey({ tenantId, commandId, subjectId: compact.toUpperCase() })).toBe(key);
    expect(key).toBe(JSON.stringify([tenantId, commandId, hyphenated]));
    expect(erasureKey({ tenantId, commandId: `${commandId}x`, subjectId: compact })).not.toBe(key);
  });
});
