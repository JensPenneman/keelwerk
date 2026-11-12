import { describe, expect, test } from 'vitest';
import {
  collect,
  createdFrame,
  effectRow,
  headFrame,
  idsOf,
  plainEntry,
  source,
} from '../../test/pending-effect-kit.ts';
import type { LiveFrame } from '../invoker/live-frame.ts';
import { pendingEffectFrames } from './pending-effect-frames.ts';

describe('pendingEffectFrames bound', () => {
  test('a backlog over the bound is still delivered, in order, with the opening state and none of head', async () => {
    const seen = await collect(
      [createdFrame('a'), createdFrame('b'), createdFrame('c'), headFrame('H1')],
      {
        maxHeld: 2,
      },
    );
    expect(idsOf(seen)).toEqual(['a', 'b', 'c', 'head']);
    expect(seen[3]).toEqual({ control: 'head', state: 'H1' });
    expect(JSON.stringify(seen.slice(0, 3))).not.toContain('H1');
    const reopened = await collect(
      [createdFrame('a'), createdFrame('b'), createdFrame('c'), createdFrame('d'), headFrame('H1')],
      { maxHeld: 2, after: 'R0' },
    );
    expect(idsOf(reopened)).toEqual(['a', 'b', 'c', 'd', 'head']);
    expect(reopened[3]).toMatchObject({ event: { id: 'd', state: 'R0' }, state: 'R0' });
    const within = await collect([createdFrame('a'), createdFrame('b'), headFrame('H1')], {
      maxHeld: 2,
    });
    expect(idsOf(within)).toEqual(['a', 'b', 'head']);
  });

  test('past the bound the held effects are released before any head, and the inner stream is read only as far as needed', async () => {
    const frames = [createdFrame('a'), createdFrame('b'), createdFrame('c'), createdFrame('d')];
    let calls = 0;
    const neverHead = {
      [Symbol.asyncIterator]: () => ({
        next: (): Promise<IteratorResult<LiveFrame<unknown>>> => {
          const frame = frames[calls++];
          return frame === undefined
            ? new Promise<IteratorResult<LiveFrame<unknown>>>(() => {})
            : Promise.resolve({ done: false, value: frame });
        },
      }),
    };
    const stream = pendingEffectFrames(
      neverHead,
      { plain: ['parcel', 'depot'], where: undefined, entry: plainEntry, after: undefined },
      2,
    )[Symbol.asyncIterator]();
    const first = await stream.next();
    expect(calls).toBe(3);
    const rest = [await stream.next(), await stream.next()];
    const seen = [first, ...rest].map((step) => (step.value.event as { id: string }).id);
    expect(seen).toEqual(['a', 'b', 'c']);
    for (const step of [first, ...rest]) {
      expect(step.value).not.toHaveProperty('state');
      expect(step.value).not.toHaveProperty('event.state');
    }
    expect(calls).toBe(3);
    const passedThrough = await stream.next();
    expect((passedThrough.value.event as { id: string }).id).toBe('d');
    expect(calls).toBe(4);
  });

  test('past the bound a row that is no longer pending is dropped', async () => {
    const failed: LiveFrame<unknown> = {
      event: { type: 'changed', id: 'd', version: 2, row: effectRow('d', { status: 'failed' }) },
    };
    const stream = pendingEffectFrames(
      source([
        createdFrame('a'),
        createdFrame('b'),
        createdFrame('c'),
        failed,
        createdFrame('e'),
        headFrame('H1'),
      ]),
      { plain: ['parcel', 'depot'], where: undefined, entry: plainEntry, after: undefined },
      2,
    )[Symbol.asyncIterator]();
    const seen: LiveFrame<unknown>[] = [];
    for (;;) {
      const step = await stream.next();
      if (step.done === true) break;
      seen.push(step.value);
    }
    expect(idsOf(seen)).toEqual(['a', 'b', 'c', 'e', 'head']);
  });
});
