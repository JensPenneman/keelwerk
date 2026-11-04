import type { Condition } from '@keelwerk/core';
import { expect, test } from 'vitest';
import { cursorSignature } from './cursor-signature.ts';

const sort = [{ field: 'title', direction: 'asc' }] as const;
const where: Condition = { op: 'eq', field: 'a', value: 1 };

test('a signature is eleven base64url characters', () => {
  expect(cursorSignature(sort, where)).toMatch(/^[A-Za-z0-9_-]{11}$/);
});

test('the same sort and filter give the same signature, whatever the key order', () => {
  const reordered = { value: 1, field: 'a', op: 'eq' } as Condition;
  expect(cursorSignature(sort, reordered)).toBe(cursorSignature(sort, where));
});

test('another sort, direction, filter or operand gives another signature', () => {
  const base = cursorSignature(sort, where);
  expect(cursorSignature([{ field: 'title', direction: 'desc' }], where)).not.toBe(base);
  expect(cursorSignature([{ field: 'body', direction: 'asc' }], where)).not.toBe(base);
  expect(cursorSignature(sort, undefined)).not.toBe(base);
  expect(cursorSignature(sort, { op: 'eq', field: 'a', value: 2 })).not.toBe(base);
  expect(cursorSignature(sort, { op: 'eq', field: 'a', value: '1' })).not.toBe(base);
});

test('values that are not JSON are told apart', () => {
  const at = (value: unknown): string => cursorSignature(sort, { op: 'eq', field: 'a', value });
  expect(at(1n)).not.toBe(at(1));
  expect(at(new Uint8Array([1]))).not.toBe(at(new Uint8Array([2])));
  expect(at(Temporal.Instant.from('2026-01-01T00:00:00Z'))).not.toBe(
    at(Temporal.Instant.from('2026-01-02T00:00:00Z')),
  );
  expect(at(Temporal.PlainDate.from('2026-01-01'))).not.toBe(at('2026-01-01'));
  expect(at(new Set(['a', 'b']))).toBe(at(new Set(['b', 'a'])));
  expect(at(new Date(0))).not.toBe(at(null));
});
