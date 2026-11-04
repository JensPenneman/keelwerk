import { describe, expect, test } from 'vitest';
import { fieldOf } from '../../test/support/field-of.ts';
import { decodeCursor } from './decode-cursor.ts';
import { encodeCursor } from './encode-cursor.ts';

const fields = [
  fieldOf('instant', 'a'),
  fieldOf('integer', 'b'),
  fieldOf('integer', 'c', { constraints: { wide: true } }),
  fieldOf('date', 'd'),
  fieldOf('string', 'e'),
];

describe('decodeCursor', () => {
  test('restores the domain values and the id', () => {
    const values = [
      Temporal.Instant.from('2026-01-01T00:00:00.5Z'),
      4,
      9007199254740993n,
      Temporal.PlainDate.from('2026-01-02'),
      null,
    ];
    const cursor = encodeCursor(values, '00000000-0000-7000-8000-000000000005', 'sig');
    expect(decodeCursor(cursor, fields, 'sig')).toEqual({
      values,
      id: '00000000-0000-7000-8000-000000000005',
    });
  });

  test('another signature is core.cursor_mismatch', () => {
    const cursor = encodeCursor([null, null, null, null, null], 'row', 'one');
    expect(() => decodeCursor(cursor, fields, 'two')).toThrow(
      expect.objectContaining({ kind: 'validation', code: 'core.cursor_mismatch' }),
    );
  });

  test.each([
    ['not base64url JSON', '!!!'],
    ['not an array', Buffer.from('{"a":1}').toString('base64url')],
    ['too few members', Buffer.from('["x","sig"]').toString('base64url')],
    [
      'an id that is not text',
      Buffer.from('[null,null,null,null,null,5,"sig"]').toString('base64url'),
    ],
    [
      'a value of the wrong type',
      Buffer.from('[7,null,null,null,null,"00000000-0000-7000-8000-000000000005","sig"]').toString(
        'base64url',
      ),
    ],
    [
      'an instant that does not parse',
      Buffer.from(
        '["x",null,null,null,null,"00000000-0000-7000-8000-000000000005","sig"]',
      ).toString('base64url'),
    ],
    ['an id that is not a uuid', '[null,null,null,null,null,"garbage","sig"]'],
  ])('%s is core.cursor_mismatch', (_name, cursor) => {
    const encoded = cursor.startsWith('[') ? Buffer.from(cursor).toString('base64url') : cursor;
    expect(() => decodeCursor(encoded, fields, 'sig')).toThrow(
      expect.objectContaining({ kind: 'validation', code: 'core.cursor_mismatch' }),
    );
  });

  test.each([
    ['a fractional integer', fieldOf('integer', 'k'), '1.5'],
    ['an unsafe integer', fieldOf('integer', 'k'), '9007199254740993'],
    [
      'an integer past int64',
      fieldOf('integer', 'k', { constraints: { wide: true } }),
      '"9223372036854775808"',
    ],
    ['text for a boolean', fieldOf('boolean', 'k'), '"yes"'],
    ['a number for a string', fieldOf('string', 'k'), '4'],
    ['a non-uuid ref', fieldOf('ref', 'k'), '"garbage"'],
    ['a string for a float', fieldOf('float', 'k'), '"1"'],
    ['a decimal that is not a number', fieldOf('decimal', 'k'), '"1e5"'],
  ])('%s is core.cursor_mismatch', (_name, field, value) => {
    const cursor = Buffer.from(`[${value},"00000000-0000-7000-8000-000000000005","sig"]`).toString(
      'base64url',
    );
    expect(() => decodeCursor(cursor, [field], 'sig')).toThrow(
      expect.objectContaining({ kind: 'validation', code: 'core.cursor_mismatch' }),
    );
  });

  test('valid values of the other kinds come back in the domain form', () => {
    const kinds = [
      fieldOf('boolean', 'a'),
      fieldOf('float', 'b'),
      fieldOf('decimal', 'c'),
      fieldOf('ref', 'd'),
      fieldOf('string', 'e'),
    ];
    const ref = '00000000-0000-7000-8000-000000000001';
    const cursor = encodeCursor(
      [true, 1.5, '-2.50', ref, 'x'],
      '00000000-0000-7000-8000-000000000005',
      'sig',
    );
    expect(decodeCursor(cursor, kinds, 'sig').values).toEqual([true, 1.5, '-2.50', ref, 'x']);
  });
});
