import type { LiveFrame } from '@keelwerk/core';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import type { BoardKit, CardEvent } from './support/live-kit.ts';
import { people, startBoard } from './support/live-kit.ts';
import { recordingLive } from './support/recording-live.ts';

vi.setConfig({ testTimeout: 60_000 });

/** Three held batches would overflow: the writes during the start are more than that. */
const slow = recordingLive({ maxBufferedItems: 150, maxHeldBatches: 2 });

describe('a start that takes longer than the batches the hub holds', () => {
  let kit: BoardKit;
  beforeAll(async () => {
    kit = await startBoard('memory', slow.module);
  });
  afterAll(async () => {
    await kit.stop();
  });

  const card = (title: string) =>
    kit.write<{ id: string }>(kit.acme, 'board.card.create', { owner: 'ada', title });

  test('a snapshot paging while many batches arrive reaches head without a reset and loses nothing', async () => {
    for (let at = 0; at < 120; at += 1) await card(`old ${at}`);
    // 120 rows are two pages: the second waits for the client to read the first.
    const iterator = kit.open(kit.acme, people.ada, { from: 'beginning' });
    const frames: LiveFrame<CardEvent>[] = [];
    const first = await iterator.next();
    if (first.done === true) throw new Error('the stream ended at once');
    frames.push(first.value);
    const watcher = kit.subscribe(kit.acme, people.ada);
    const made: string[] = [];
    try {
      await watcher.ready();
      for (let at = 0; at < 5; at += 1) made.push((await card(`during ${at}`)).id);
      await watcher.until((got) => got.filter((frame) => 'event' in frame).length >= 5);
    } finally {
      await watcher.stop();
    }
    for (;;) {
      const step = await iterator.next();
      if (step.done === true) throw new Error('the stream ended before head');
      frames.push(step.value);
      if ('control' in step.value) break;
    }
    expect(frames.filter((frame) => 'control' in frame)).toEqual([
      expect.objectContaining({ control: 'head' }),
    ]);
    const told = new Set(frames.flatMap((frame) => ('event' in frame ? [frame.event.cardId] : [])));
    for (const id of made) expect(told.has(id)).toBe(true);
    // The stream is live after its head.
    const after = await card('after');
    for (;;) {
      const step = await iterator.next();
      if (step.done === true) throw new Error('the stream ended');
      expect(step.value).not.toMatchObject({ control: 'reset' });
      if ('event' in step.value && step.value.event.cardId === after.id) break;
    }
    await iterator.return?.();
  });
});
