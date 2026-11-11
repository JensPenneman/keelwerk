import { describe, expect, test } from 'vitest';
import { field } from '../fields/field.ts';
import { shape } from '../fields/shape.ts';
import type { ActionEntry } from '../registry/action-entry.ts';
import { sensitiveWithMember } from './sensitive-with-member.ts';

const continuation = {
  input: shape({ id: field.string(), note: field.string() }),
  outcomeWith: shape({
    recipient: field.string().personal(),
    cc: field.list(field.string()).personal(),
    token: field.secret(),
    tokens: field.list(field.secret()),
    note: field.string(),
  }),
} as unknown as ActionEntry;

describe('sensitiveWithMember', () => {
  test('names the first personal or secret member the continuation declares', () => {
    expect(sensitiveWithMember(continuation, { recipient: 'a@b.c' })).toBe('recipient');
    expect(sensitiveWithMember(continuation, { note: 'x', cc: ['a@b.c'] })).toBe('cc');
    expect(sensitiveWithMember(continuation, { token: 't' })).toBe('token');
    expect(sensitiveWithMember(continuation, { tokens: ['t'] })).toBe('tokens');
  });

  test('plain and undeclared members pass', () => {
    expect(sensitiveWithMember(continuation, { id: 'row-1', note: 'x' })).toBeUndefined();
    expect(sensitiveWithMember(continuation, { other: 1 })).toBeUndefined();
    expect(sensitiveWithMember(continuation, {})).toBeUndefined();
  });
});
