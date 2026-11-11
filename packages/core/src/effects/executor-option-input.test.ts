import { describe, expect, test } from 'vitest';
import { field } from '../fields/field.ts';
import { shape } from '../fields/shape.ts';
import type { EffectEntry } from '../registry/effect-entry.ts';
import { executorOptionInput } from './executor-option-input.ts';

const entry: EffectEntry = {
  ref: 'courier.deliver',
  module: 'courier',
  name: 'deliver',
  performer: 'executor',
  executor: 'courier.deliver',
  input: shape({
    owner: field.subject(),
    url: field.string(),
    to: field.string().personal({ subject: 'owner' }),
  }),
  output: shape({}),
};

describe('executorOptionInput', () => {
  const stored = { owner: 'o1', url: 'https://x.example', to: { $kwe: 1, k: 'k', n: 'n', c: 'c' } };
  const input = executorOptionInput(entry, stored) as typeof stored;

  test('members that are not personal read as stored', () => {
    expect(input.url).toBe('https://x.example');
    expect(input.owner).toBe('o1');
  });

  test('a personal member throws a refusal that names the executor, and never gives the envelope', () => {
    expect(() => input.to).toThrow(
      expect.objectContaining({
        kind: 'internal',
        code: 'core.request_not_allowed',
        message: expect.stringContaining('courier.deliver'),
      }),
    );
    expect(() => ({ ...input })).toThrow(
      expect.objectContaining({ code: 'core.request_not_allowed' }),
    );
  });

  test('anything but an object passes unchanged', () => {
    expect(executorOptionInput(entry, undefined)).toBeUndefined();
    expect(executorOptionInput(entry, 'x')).toBe('x');
  });
});
