import type { StreamFrame } from '@keelwerk/testing';
import { describe, expect, test } from 'vitest';
import { trpcConformanceSurface } from './support/trpc-kit.ts';
import { trpcFrameOf } from './support/trpc-subscribe-over.ts';

const surface = trpcConformanceSurface();
const message = (data: unknown, id?: string): StreamFrame => ({ event: 'message', id, data });
const read = (data: unknown, id?: string) =>
  trpcFrameOf(message(data, id), surface, 'loans.loanEvents');

describe("the codec's frame reader (a frame is an item or a control frame, by 'data')", () => {
  test('an item is classified by data, whatever data holds', () => {
    expect(read({ data: { kind: 'created' } })).toEqual({
      event: 'data',
      id: undefined,
      data: { kind: 'created' },
    });
    expect(read({ data: { control: 'reset', reason: 'resync' } })).toEqual({
      event: 'data',
      id: undefined,
      data: { control: 'reset', reason: 'resync' },
    });
    expect(read({ data: { id: 'x', data: 1 }, id: 's1' }, 's1')).toMatchObject({
      event: 'data',
      id: 's1',
      data: { id: 'x', data: 1 },
    });
  });

  test('a control frame is classified by control, and its id is its state', () => {
    expect(read({ control: 'head', state: 's1' }, 's1')).toEqual({
      event: 'head',
      id: 's1',
      data: { state: 's1' },
    });
    expect(read({ control: 'reset', reason: 'overflow', state: 's2' }, 's2')).toMatchObject({
      event: 'reset',
      id: 's2',
    });
    expect(read({ control: 'reset', reason: 'resync' })).toMatchObject({
      event: 'reset',
      id: undefined,
    });
    expect(read({ control: 'gap', missed: 3 })).toMatchObject({ event: 'gap', id: undefined });
  });

  test('a payload with both data and control, or with neither, is malformed', () => {
    expect(() => read({ data: 1, control: 'reset' })).toThrow(/malformed frame/i);
    expect(() => read({ data: 1, control: 'bogus' })).toThrow(/malformed frame/i);
    expect(() => read({})).toThrow(/malformed frame/i);
    expect(() => read({ kind: 'created' })).toThrow(/malformed frame/i);
    expect(() => read('head')).toThrow(/malformed frame/i);
  });

  test('a gap or a stateless reset that carries an id is malformed', () => {
    expect(() => read({ control: 'gap' }, 's1')).toThrow(/malformed frame/i);
    expect(() => read({ control: 'reset', reason: 'resync' }, 's1')).toThrow(/malformed frame/i);
  });

  test('an id that is not the state of the head or of the reset, or not the id of the item, is malformed', () => {
    expect(() => read({ control: 'head', state: 's1' }, 's2')).toThrow(/malformed frame/i);
    expect(() => read({ control: 'reset', reason: 'overflow', state: 's1' }, 's2')).toThrow(
      /malformed frame/i,
    );
    expect(() => read({ data: 1, id: 's1' }, 's2')).toThrow(/malformed frame/i);
    expect(() => read({ data: 1 }, 's2')).toThrow(/malformed frame/i);
  });

  test('a head of an action that is not resumable has a state and no id', () => {
    expect(read({ control: 'head', state: 's1' })).toMatchObject({ event: 'head', id: undefined });
  });

  test('a control string the reader does not know is skipped', () => {
    expect(read({ control: 'future' })).toBeUndefined();
  });
});
