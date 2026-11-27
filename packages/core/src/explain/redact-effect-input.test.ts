import { describe, expect, test } from 'vitest';
import { field } from '../fields/field.ts';
import { shape } from '../fields/shape.ts';
import { redactEffectInput } from './redact-effect-input.ts';

describe('redactEffectInput', () => {
  const schema = shape({
    to: field.string(),
    note: field.string().optional().hidden(),
    token: field.secret(),
    tokens: field.list(field.secret()),
    emails: field.list(field.string().personal({ subject: 'to' })),
  });

  test('keeps the plain fields and redacts the hidden, secret and personal ones', () => {
    const input = { to: 'ada', note: 'x', token: 'y', tokens: ['a', 'b'], emails: ['c'] };
    expect(redactEffectInput('effectInput', schema, input)).toEqual({
      to: 'ada',
      note: '[redacted]',
      token: '[redacted]',
      tokens: '[redacted]',
      emails: '[redacted]',
    });
  });

  test('redacts everything of an input whose shape is unknown', () => {
    expect(redactEffectInput('effectInput', undefined, { to: 'ada' })).toEqual({
      to: '[redacted]',
    });
    expect(redactEffectInput('effectInput', schema, 'plain')).toBe('plain');
  });
});
