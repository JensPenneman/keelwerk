import { describe, expect, test } from 'vitest';
import { normalizeCondition } from '../conditions/normalize-condition.ts';
import { field } from '../fields/field.ts';
import { shape } from '../fields/shape.ts';
import type { EffectEntry } from '../registry/effect-entry.ts';
import { encodeEventValue } from '../write-path/encode-event-value.ts';
import { matchingPlainInput } from './matching-plain-input.ts';

const entry = {
  module: 'dispatch',
  input: shape({
    depot: field.string(),
    at: field.instant(),
    recipient: field.string().personal({ subject: 'depot' }),
  }),
} as unknown as EffectEntry;

const at = Temporal.Instant.from('2026-11-12T10:00:00Z');
const stored = encodeEventValue({ depot: 'north', at });
const plain = new Set(['depot', 'at']);

describe('matchingPlainInput', () => {
  test('answers the decoded plain input when the where holds, and undefined when it does not', () => {
    const north = normalizeCondition({ depot: 'north' });
    const south = normalizeCondition({ depot: 'south' });
    const input = matchingPlainInput(entry, plain, north, stored);
    expect(input?.depot).toBe('north');
    expect(input?.at).toBeInstanceOf(Temporal.Instant);
    expect(matchingPlainInput(entry, plain, south, stored)).toBeUndefined();
  });

  test('no where answers the plain input; a member outside plain or a sealed value is left out', () => {
    const envelope = { $kwe: 1, k: 'key-1', n: 'nonce', c: 'cipher' };
    const withSealed = { ...(stored as object), recipient: envelope };
    expect(matchingPlainInput(entry, plain, undefined, withSealed)).toEqual({ depot: 'north', at });
    expect(matchingPlainInput(entry, new Set(['depot']), undefined, withSealed)).toEqual({
      depot: 'north',
    });
    expect(
      matchingPlainInput(entry, new Set(['depot', 'recipient']), undefined, withSealed),
    ).toEqual({ depot: 'north' });
  });

  test('a plain member that holds a sealed value is never judged as absent: a negative where does not hold', () => {
    // Stored when `depot` was a personal member: the envelope is left out of the plain input.
    const envelope = { $kwe: 1, k: 'key-1', n: 'nonce', c: 'cipher' };
    const old = { ...(stored as object), depot: envelope };
    for (const where of [{ not: { depot: 'south' } }, { depot: { ne: 'south' } }]) {
      expect(
        matchingPlainInput(entry, plain, normalizeCondition(where), old),
        JSON.stringify(where),
      ).toBeUndefined();
    }
  });

  test('a stored value its field cannot decode or a condition the input cannot answer matches nothing', () => {
    expect(matchingPlainInput(entry, plain, undefined, { depot: 'north', at: 5 })).toBeUndefined();
    expect(
      matchingPlainInput(entry, plain, undefined, { depot: 'north', at: 'not an instant' }),
    ).toBeUndefined();
    expect(
      matchingPlainInput(entry, plain, normalizeCondition({ missing: 'x' }), stored),
    ).toBeUndefined();
  });
});
