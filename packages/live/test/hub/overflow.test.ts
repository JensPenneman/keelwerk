import type { LiveFrame } from '@keelwerk/core';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { Adapter, BoardKit, CardEvent } from './support/live-kit.ts';
import { people, startBoard } from './support/live-kit.ts';
import { smallLive } from './support/small-live-module.ts';

const stateOf = (frame: LiveFrame<CardEvent> | undefined): unknown =>
  frame !== undefined && 'state' in frame ? frame.state : undefined;

describe.each(['memory', 'pglite'] as const)(
  'the buffer of a live stream on %s',
  (adapter: Adapter) => {
    let kit: BoardKit;
    beforeAll(async () => {
      kit = await startBoard(adapter, smallLive);
    });
    afterAll(async () => {
      await kit.stop();
    });

    const card = (title: string, tenant = kit.acme) =>
      kit.write<{ id: string }>(tenant, 'board.card.create', { owner: 'ada', title });

    /** Pulls the head, then lets the stream fill while nobody pulls. */
    async function pullHead(tenant = kit.acme) {
      const iterator = kit.open(tenant, people.ada);
      const head = await iterator.next();
      expect(head.value).toMatchObject({ control: 'head' });
      return { iterator, head: head.value as LiveFrame<CardEvent> };
    }

    /**
     * Writes the cards and waits until a second, pulling subscriber of the same scope has been given all
     * of them: the reader hands a batch to every listener in one go, so the buffer of the one that does not pull has settled.
     */
    async function writeAndSettle(titles: readonly string[], tenant = kit.acme): Promise<void> {
      const watcher = kit.subscribe(tenant, people.ada);
      try {
        await watcher.ready();
        for (const title of titles) await card(title, tenant);
        await watcher.until(
          (frames) => frames.filter((frame) => 'event' in frame).length >= titles.length,
        );
      } finally {
        await watcher.stop();
      }
    }

    async function drain(iterator: AsyncIterator<LiveFrame<CardEvent>>) {
      const frames: LiveFrame<CardEvent>[] = [];
      for (;;) {
        const step = await iterator.next();
        if (step.done === true) return frames;
        frames.push(step.value);
      }
    }

    test('a consumer that never pulls gets reset overflow with its last delivered token and ends', {
      timeout: 120_000,
    }, async () => {
      const { iterator, head } = await pullHead();
      await writeAndSettle(Array.from({ length: 25 }, (_, at) => `c${at}`));
      const frames = await drain(iterator);
      expect(frames).toEqual([{ control: 'reset', reason: 'overflow', state: stateOf(head) }]);
    });

    test('bytes overflow before items: three 3 KiB rows', {
      timeout: 120_000,
    }, async () => {
      const { iterator, head } = await pullHead();
      await writeAndSettle(['x'.repeat(3000), 'y'.repeat(3000), 'z'.repeat(3000)]);
      const frames = await drain(iterator);
      expect(frames).toEqual([{ control: 'reset', reason: 'overflow', state: stateOf(head) }]);
    });

    test('an overflowing acme subscriber delays no globex frame', {
      timeout: 120_000,
    }, async () => {
      const { iterator } = await pullHead(kit.acme);
      const globex = kit.subscribe(kit.globex, people.ada);
      try {
        await globex.ready();
        // Each globex frame is awaited as it is made, while the acme iterator has never been pulled
        // since its head: the stream either delivers it or the test waits for it. The wait is the
        // condition, not a time budget, so a slow or loaded machine cannot fail it; the whole
        // test is bounded only by its (generous) test timeout.
        const eventsOf = () => globex.frames.filter((frame) => 'event' in frame).length;
        for (let at = 0; at < 25; at += 1) {
          await card(`a${at}`);
          await card(`g${at}`, kit.globex);
          await globex.until(() => eventsOf() >= at + 1, 60_000);
        }
        expect(eventsOf()).toBe(25);
        const frames = await drain(iterator);
        expect(frames.at(-1)).toMatchObject({ control: 'reset', reason: 'overflow' });
      } finally {
        await globex.stop();
      }
    });
  },
);
