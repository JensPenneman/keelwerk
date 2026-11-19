import { describe, expect, test } from 'vitest';
import { backendQuotasSchema } from './backend-quotas-schema.ts';

function validate(value: unknown) {
  const result = backendQuotasSchema['~standard'].validate(value);
  if (result instanceof Promise) throw new Error('asynchronous');
  return result;
}

describe('backendQuotasSchema', () => {
  test('accepts an object of dimensions and limit texts and answers a copy', () => {
    const given = { 'notes.noteBytes': '4MiB', 'queue:commands.weight': '2' };
    const result = validate(given);
    expect(result).toEqual({ value: given });
    if (result.issues !== undefined) throw new Error('refused');
    expect(result.value).not.toBe(given);
  });

  test("refuses 'default', naming the member", () => {
    expect(validate({ 'notes.rows': 'default' })).toEqual({
      issues: [expect.objectContaining({ path: ['notes.rows'] })],
    });
  });

  test('refuses a value that is not a string, empty or longer than 40 characters', () => {
    for (const bad of [5, null, true, {}, '', 'x'.repeat(41)]) {
      expect(validate({ 'notes.rows': bad }).issues).toHaveLength(1);
    }
  });

  test('refuses what is not an object, an empty key and a key above 200 characters', () => {
    for (const bad of [null, 'x', 3, ['a'], undefined]) {
      expect(validate(bad).issues).toHaveLength(1);
    }
    expect(validate({ '': '1' }).issues).toHaveLength(1);
    expect(validate({ ['k'.repeat(201)]: '1' }).issues).toHaveLength(1);
  });

  test('refuses 1001 members and accepts 1000', () => {
    const many = (count: number) =>
      Object.fromEntries(Array.from({ length: count }, (_, index) => [`d${index}`, '1']));
    expect(validate(many(1001)).issues).toHaveLength(1);
    expect(validate(many(1000)).issues).toBeUndefined();
  });

  test('describes itself for the surface', () => {
    const props = backendQuotasSchema['~standard'] as unknown as {
      readonly jsonSchema: { input(): unknown };
    };
    expect(props.jsonSchema.input()).toMatchObject({ type: 'object', maxProperties: 1000 });
  });
});
