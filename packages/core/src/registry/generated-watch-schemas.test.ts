import { describe, expect, test } from 'vitest';
import { field } from '../fields/field.ts';
import { generatedActionSchemas } from './generated-action-schemas.ts';

const schemas = generatedActionSchemas('watch', { label: field.string() }, 'note');

function validate(schema: typeof schemas.input, value: unknown): { issues?: unknown } {
  const result = schema['~standard'].validate(value);
  if (result instanceof Promise) {
    throw new TypeError('a synchronous schema was expected');
  }
  return result;
}

describe('the registered schemas of the generated watch', () => {
  test('the registered watch input accepts WatchInput and refuses since', () => {
    const ok = validate(schemas.input, {
      ids: ['0190f3a2-7c1e-7b00-8000-000000000001'],
      filter: { label: 'x' },
      fields: ['label'],
      includeArchived: true,
      from: 'beginning',
      after: 's',
      partition: 'p',
    });
    expect(ok.issues).toBeUndefined();
    expect(validate(schemas.input, {}).issues).toBeUndefined();
    expect(validate(schemas.input, { since: 's' }).issues).toBeDefined();
    expect(validate(schemas.input, { from: 'later' }).issues).toBeDefined();
  });

  test("the ids are checked as the entity's own ids: a text that is none is refused", () => {
    expect(validate(schemas.input, { ids: ['not-an-id'] }).issues).toBeDefined();
    expect(validate(schemas.input, { ids: ['x'.repeat(100_000)] }).issues).toBeDefined();
    expect(validate(schemas.input, { ids: [] }).issues).toBeUndefined();
  });

  test('its output is permissive', () => {
    expect(validate(schemas.output, { type: 'removed', anything: 1 }).issues).toBeUndefined();
    expect(validate(schemas.output, 'text').issues).toBeUndefined();
  });
});
