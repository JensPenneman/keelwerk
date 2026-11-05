import { describe, expect, test } from 'vitest';
import { actionOf } from '../../../test/invoker/invoker-kit.ts';
import { field } from '../../fields/field.ts';
import { shape } from '../../fields/shape.ts';
import { validate } from './validate.ts';

const empty = actionOf('doc.empty', { input: shape({}) });
const filled = actionOf('doc.filled', { input: shape({ n: field.integer() }) });

describe('validate', () => {
  test('an action without input fields takes undefined as {}', async () => {
    await expect(validate(empty, undefined)).resolves.toEqual({});
    await expect(validate(empty, {})).resolves.toEqual({});
  });

  test('an action without input fields still refuses an extra key and null', async () => {
    await expect(validate(empty, { extra: 1 })).rejects.toMatchObject({ kind: 'validation' });
    await expect(validate(empty, null)).rejects.toMatchObject({ kind: 'validation' });
  });

  test('a shape with fields refuses undefined and null', async () => {
    await expect(validate(filled, undefined)).rejects.toMatchObject({ kind: 'validation' });
    await expect(validate(filled, null)).rejects.toMatchObject({ kind: 'validation' });
    await expect(validate(filled, { n: 2 })).resolves.toEqual({ n: 2 });
  });
});
