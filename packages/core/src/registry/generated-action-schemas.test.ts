import { describe, expect, test } from 'vitest';
import { field } from '../fields/field.ts';
import { generatedActionSchemas } from './generated-action-schemas.ts';

const fields = { title: field.string(), shown: field.boolean().default(true) };
const validate = (kind: 'create' | 'update', value: unknown) =>
  generatedActionSchemas(kind, fields, 'card').input['~standard'].validate(value);

describe('the registered schemas of a generated update and create', () => {
  test('the update patch leaves an omitted defaulted field absent', async () => {
    expect(await validate('update', { id: 'x', patch: { title: 'B' } })).toEqual({
      value: { id: 'x', patch: { title: 'B' } },
    });
  });

  test('the update patch keeps a given defaulted field', async () => {
    expect(await validate('update', { id: 'x', patch: { shown: false } })).toEqual({
      value: { id: 'x', patch: { shown: false } },
    });
  });

  test('the update patch refuses a name that is no field and a value of the wrong kind', async () => {
    const result = await validate('update', { id: 'x', patch: { nope: 1, shown: 'yes' } });
    const paths = (result.issues ?? []).map((issue) => issue.path);
    expect(paths).toContainEqual(['patch', 'nope']);
    expect(paths).toContainEqual(['patch', 'shown']);
  });

  test('the create input still fills the default', async () => {
    expect(await validate('create', { title: 'A' })).toEqual({
      value: { title: 'A', shown: true },
    });
  });
});
