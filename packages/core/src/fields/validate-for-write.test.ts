import { describe, expect, test } from 'vitest';
import { generatedActionSchemas } from '../registry/generated-action-schemas.ts';
import { field } from './field.ts';
import { patchShape } from './patch-shape.ts';
import { shape } from './shape.ts';
import { validateForWrite } from './validate-for-write.ts';
import { validateValue } from './validate-value.ts';

const fields = {
  title: field.string(),
  shown: field.boolean().default(true),
  ownerId: field.subject().optional(),
  meta: field
    .json(shape({ kind: field.string().default('plain'), ownerId: field.subject().optional() }))
    .optional(),
};
const upper = '0F1F2F3F-4F5F-6F7F-8F9F-AFBFCFDFEFFF';
const update = generatedActionSchemas('update', fields, 'card').input;
const create = generatedActionSchemas('create', fields, 'card').input;
const paths = (result: { readonly issues?: readonly { readonly path?: unknown }[] | undefined }) =>
  (result.issues ?? []).map((issue) => issue.path);

describe('the write validation of a patch', () => {
  test('every entry of a write leaves an omitted default out of a patch', async () => {
    const v = { id: 'x', patch: { title: 'B' } };
    expect(await update['~standard'].validate(v)).toEqual({ value: v });
    expect(await validateForWrite(update, v)).toEqual({ value: v });
    expect(validateValue(field.json(update), v, { write: true })).toEqual({ value: v });
    expect(await validateForWrite(patchShape(fields), { title: 'B' })).toEqual({
      value: { title: 'B' },
    });
  });

  test('a patch and a create treat a key given as undefined as main does', async () => {
    const patch = { id: 'x', patch: { title: 'x', extra: undefined } };
    const expected = { value: { id: 'x', patch: { title: 'x' } } };
    expect(await update['~standard'].validate(patch)).toEqual(expected);
    expect(await validateForWrite(update, patch)).toEqual(expected);
    const made = { title: 'x', extra: undefined };
    expect(paths(await create['~standard'].validate(made))).toEqual([['extra']]);
    expect(paths(await validateForWrite(create, made))).toEqual([['extra']]);
  });

  test('the lower-case rule holds in a patch and a nested shape of a patch, for writes only', async () => {
    const v = { id: 'x', patch: { ownerId: upper, meta: { ownerId: upper } } };
    expect(paths(await validateForWrite(update, v))).toEqual([
      ['patch', 'ownerId'],
      ['patch', 'meta', 'ownerId'],
    ]);
    expect(await update['~standard'].validate(v)).toEqual({
      value: { id: 'x', patch: { ownerId: upper, meta: { kind: 'plain', ownerId: upper } } },
    });
  });

  test('a create and a nested shape fill their defaults', async () => {
    expect(await validateForWrite(create, { title: 'A', meta: {} })).toEqual({
      value: { title: 'A', shown: true, meta: { kind: 'plain' } },
    });
    expect(await validateForWrite(update, { id: 'x', patch: { meta: {} } })).toEqual({
      value: { id: 'x', patch: { meta: { kind: 'plain' } } },
    });
  });
});
