import type { FieldNode } from '@keelwerk/core';
import { expect, test } from 'vitest';
import { queryStringRepresentable } from '../src/query-string-representable.ts';

const json: FieldNode = { kind: 'json', optional: true, access: 'read-write', schema: {} };
const text: FieldNode = { kind: 'string', optional: false, access: 'read-write' };
const shape = (fields: Record<string, FieldNode>): FieldNode => ({
  kind: 'shape',
  optional: false,
  access: 'read-write',
  fields,
});

test('filter and sort are representable whatever their node; other non-scalars are not', () => {
  expect(queryStringRepresentable(shape({ filter: json, sort: json, q: text }))).toBe(true);
  expect(queryStringRepresentable(shape({ q: text, extra: json }))).toBe(false);
});
