import { describe, expect, test } from 'vitest';
import { sseEventOf } from './sse-event-of.ts';

describe('sseEventOf', () => {
  test('writes id, event and one data line', () => {
    expect(sseEventOf('data', { a: 1 }, 'v2.tok')).toBe(
      'id: v2.tok\nevent: data\ndata: {"a":1}\n\n',
    );
  });

  test('a null id is `id:` alone and no id writes none', () => {
    expect(sseEventOf('x', 1, null)).toBe('id:\nevent: x\ndata: 1\n\n');
    expect(sseEventOf('x', 1)).toBe('event: x\ndata: 1\n\n');
  });

  test.each(['a\nb', 'a\rb', 'a\0b', '\n'])(
    'an event name %j is refused as an internal error',
    (name) => {
      expect(() => sseEventOf(name, {})).toThrow(expect.objectContaining({ kind: 'internal' }));
    },
  );

  test.each(['v2.a\nevent: end', 'v2.a\rdata: x', 'v2.\0'])(
    'an id %j is refused as an internal error',
    (id) => {
      expect(() => sseEventOf('data', {}, id)).toThrow(
        expect.objectContaining({ kind: 'internal' }),
      );
    },
  );

  test('a line break in the data stays escaped inside the one data line', () => {
    expect(sseEventOf('data', 'a\nb')).toBe('event: data\ndata: "a\\nb"\n\n');
  });
});
