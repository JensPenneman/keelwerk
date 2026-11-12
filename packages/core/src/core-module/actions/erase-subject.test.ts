import { describe, expect, test } from 'vitest';
import type { Shape } from '../../fields/shape.ts';
import { decoySubject } from '../../keys/decoy-subject.ts';
import { eraseSubject } from './erase-subject.ts';

const input = (eraseSubject.spec as { readonly input: Shape }).input;
const validate = (subjectId: string) =>
  input['~standard'].validate({ subjectId, reason: 'subjectRequest' });

describe('the input of core.eraseSubject', () => {
  test('the reserved decoy subject is a validation error naming the field, in both spellings, and only it', async () => {
    for (const text of [decoySubject, decoySubject.replaceAll('-', '')]) {
      const result = await validate(text);
      expect(
        result.issues?.map((issue) => issue.path),
        text,
      ).toEqual([['subjectId']]);
    }
    for (const text of [
      '0192f3a0-0000-7000-8000-0000000000a1',
      '0192f3a00000700080000000000000a1',
      '00000000-0000-4000-8000-00000000decd',
      '00000000000040008000000000000dec',
    ]) {
      expect((await validate(text)).issues, text).toBeUndefined();
    }
  });

  test('the stored pattern of the subject is the plain one: no lookahead, no decoy constant', () => {
    const subject = input.fields.subjectId as unknown as {
      readonly options: { readonly pattern: string };
    };
    const { pattern } = subject.options;
    expect(pattern).not.toMatch(/\(\?[=!<]/);
    expect(pattern).not.toContain('decc');
    expect(new RegExp(pattern).test(decoySubject)).toBe(true);
  });
});
