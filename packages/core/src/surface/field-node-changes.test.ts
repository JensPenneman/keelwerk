import { describe, expect, test } from 'vitest';
import { field } from '../fields/field.ts';
import { shape } from '../fields/shape.ts';
import { fieldNodeOf } from './field-node-of.ts';
import { toJsonSchema } from './to-json-schema.ts';

const converting = {
  '~standard': {
    version: 1 as const,
    vendor: 'test',
    validate: (value: unknown) => ({ value }),
    jsonSchema: {
      input: () => ({ type: 'string' }),
      output: () => ({ type: 'number' }),
    },
  },
};
const context = { declaredBy: 'library', tag: 1, prefixOf: () => 'book' };

describe('the F-09 change notes of the field nodes', () => {
  test('a json node carries the input and the output schema', () => {
    const node = fieldNodeOf(field.json(converting), context);
    expect(node).toMatchObject({
      kind: 'json',
      input: { type: 'string' },
      output: { type: 'number' },
      schema: { type: 'number' },
    });
    expect(toJsonSchema(node, { direction: 'input' })).toEqual({ type: 'string' });
    expect(toJsonSchema(node, { direction: 'output' })).toEqual({ type: 'number' });
  });

  test('a decimal node carries precision and scale', () => {
    expect(fieldNodeOf(field.decimal({ precision: 12, scale: 3 }), context)).toMatchObject({
      kind: 'decimal',
      precision: 12,
      scale: 3,
    });
  });

  test('the max and min merge types stay on the node', () => {
    const base = field.integer();
    expect(fieldNodeOf(field.integer().tag(2), context)).not.toHaveProperty('merge');
    const merged = { ...base, flags: { ...base.flags, merge: 'max' as const } };
    expect(fieldNodeOf(merged, context)).toMatchObject({ merge: 'max' });
  });

  test('recorded tags keep their numbers when a member is inserted', () => {
    const before = shape({ a: field.string(), b: field.string() });
    const after = shape({ a: field.string(), inserted: field.string(), b: field.string() });
    const memberTags = { a: 1, b: 2 };
    const node = (schema: typeof before | typeof after) =>
      fieldNodeOf(field.json(schema), { ...context, memberTags });
    const tagsOf = (value: ReturnType<typeof node>) =>
      value.kind === 'shape'
        ? Object.fromEntries(
            Object.entries(value.fields).map(([name, member]) => [name, member.tag]),
          )
        : {};
    expect(tagsOf(node(before))).toEqual({ a: 1, b: 2 });
    expect(tagsOf(node(after))).toEqual({ a: 1, inserted: 3, b: 2 });
    expect(tagsOf(fieldNodeOf(field.json(after), context))).toEqual({ a: 1, inserted: 2, b: 3 });
  });
});
