import { describe, expect, test } from 'vitest';
import { field } from '../fields/field.ts';
import { shape } from '../fields/shape.ts';
import { redactEffectInput } from './redact-effect-input.ts';

describe('redactEffectInput', () => {
  const schema = shape({
    to: field.string(),
    note: field.string().optional().hidden(),
    token: field.secret(),
  });

  test('keeps the plain fields and redacts the hidden and secret ones', () => {
    expect(redactEffectInput(schema, { to: 'ada', note: 'x', token: 'y' })).toEqual({
      to: 'ada',
      note: '[redacted]',
      token: '[redacted]',
    });
  });

  test('redacts everything of an input whose shape is unknown', () => {
    expect(redactEffectInput(undefined, { to: 'ada' })).toEqual({ to: '[redacted]' });
    expect(redactEffectInput(schema, 'plain')).toBe('plain');
  });
});
