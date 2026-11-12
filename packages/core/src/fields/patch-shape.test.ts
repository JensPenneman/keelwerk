import { describe, expect, test } from 'vitest';
import { field } from './field.ts';
import { patchShape } from './patch-shape.ts';

const patch = patchShape({ title: field.string(), shown: field.boolean().default(true) });
const validate = (value: unknown) => patch['~standard'].validate(value);

describe('a patch shape', () => {
  test('an absent member stays absent, though it has a default', async () => {
    expect(await validate({ title: 'B' })).toEqual({ value: { title: 'B' } });
    expect(await validate({})).toEqual({ value: {} });
  });

  test('a member given as undefined stays absent', async () => {
    expect(await validate({ title: 'B', shown: undefined })).toEqual({ value: { title: 'B' } });
  });

  test('a named member is checked as shape checks it', async () => {
    const result = await validate({ shown: 'yes' });
    expect(result.issues?.map((issue) => issue.path)).toEqual([['shown']]);
    expect(await validate({ shown: false })).toEqual({ value: { shown: false } });
  });

  test('a name that is no member is refused, and a value that is no object is refused', async () => {
    expect((await validate({ nope: 1 })).issues?.map((issue) => issue.path)).toEqual([['nope']]);
    for (const value of [null, 'x', 3, ['title']]) {
      expect((await validate(value)).issues?.[0]?.message).toBe('expected an object');
    }
  });

  test('every member of fields is optional', () => {
    for (const member of Object.values(patch.fields)) {
      expect(member.flags.optional).toBe(true);
    }
  });
});
