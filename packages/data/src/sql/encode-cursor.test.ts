import { expect, test } from 'vitest';
import { encodeCursor } from './encode-cursor.ts';

function read(cursor: string): unknown {
  return JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
}

test('a cursor is base64url of a JSON array: values, id, signature', () => {
  const cursor = encodeCursor(['alpha', 3], 'row-1', 'sig');
  expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
  expect(read(cursor)).toEqual(['alpha', 3, 'row-1', 'sig']);
});

test('domain values take their JSON form and absent values are null', () => {
  const cursor = encodeCursor(
    [
      Temporal.Instant.from('2026-01-01T00:00:00Z'),
      Temporal.PlainDate.from('2026-01-02'),
      9007199254740993n,
      new Uint8Array([1, 2]),
      null,
      undefined,
      new Date(0),
    ],
    'id',
    'sig',
  );
  expect(read(cursor)).toEqual([
    '2026-01-01T00:00:00Z',
    '2026-01-02',
    '9007199254740993',
    'AQI',
    null,
    null,
    '1970-01-01T00:00:00.000Z',
    'id',
    'sig',
  ]);
});
