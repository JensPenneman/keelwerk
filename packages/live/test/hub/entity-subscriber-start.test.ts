import type { LiveFrame } from '@keelwerk/core';
import { describe, expect, test, vi } from 'vitest';
import { planGroupKey } from '../../src/hub/plan-group-key.ts';
import type { ReaderBatch } from '../../src/hub/reader-batch.ts';
import type { ReaderListener } from '../../src/hub/reader-listener.ts';
import type { CardEvent } from './support/live-kit.ts';
import { people, startBoard } from './support/live-kit.ts';
import { recordingLive } from './support/recording-live.ts';

const attached = vi.hoisted(() => [] as ReaderListener[]);

vi.mock('../../src/hub/create-scope-readers.ts', async (original) => {
  const real = await original<typeof import('../../src/hub/create-scope-readers.ts')>();
  return {
    ...real,
    createScopeReaders: (...args: Parameters<typeof real.createScopeReaders>) => {
      const readers = real.createScopeReaders(...args);
      return {
        ...readers,
        attach: (kernel: never, listener: ReaderListener) => {
          attached.push(listener);
          return readers.attach(kernel, listener);
        },
      };
    },
  };
});

vi.setConfig({ testTimeout: 60_000 });

/** A batch that touches one card the subscriber holds no record of. */
const unknownCard: ReaderBatch = {
  from: 0n,
  to: 1_000_000n,
  events: [
    {
      position: 1_000_000n,
      stream: { type: 'board.card', id: 'card_unknown' },
      type: 'board.card.changed',
      partition: null,
    },
  ],
  rows: new Map([['board.card', new Map([['card_unknown', undefined]])]]),
  verdicts: new Map(),
  earlier: new Map(),
} as unknown as ReaderBatch;

describe('a subscriber whose start is still being read', () => {
  test('names the streams of a batch it cannot place while its start is read, and the set is still exact', async () => {
    // 120 rows are two pages, the set holds 200 ids and stays exact; the snapshot waits for the client.
    const kit = await startBoard(
      'memory',
      recordingLive({ maxBufferedItems: 150, visibilityBound: 200 }).module,
    );
    try {
      for (let at = 0; at < 120; at += 1) {
        await kit.write(kit.acme, 'board.card.create', { owner: 'ada', title: `old ${at}` });
      }
      const stream = kit.open(kit.acme, people.ada, { from: 'beginning' });
      const first = await stream.next();
      expect(first.done).toBe(false);
      const [listener] = attached;
      // The reader delivers after its unit has closed, by when the start may have finished and the set filled up.
      expect(listener?.undecided?.({ ...unknownCard, to: 1n })).toEqual(['card_unknown']);
      for (;;) {
        const step = await stream.next();
        if (step.done === true) throw new Error('the stream ended before head');
        if ('control' in step.value) break;
      }
      // Live with an exact set, a stream the set does not hold was never visible: nothing to ask.
      expect(listener?.undecided?.(unknownCard)).toEqual([]);
      await stream.return?.();
    } finally {
      await kit.stop();
    }
  });

  test('a card that leaves the view while the start finishes is told as removed, not as a resync', async () => {
    const kit = await startBoard(
      'memory',
      recordingLive({ maxBufferedItems: 150, visibilityBound: 3 }).module,
    );
    try {
      for (let at = 0; at < 120; at += 1) {
        await kit.write(kit.acme, 'board.card.create', { owner: 'ada', title: `old ${at}` });
      }
      // 120 rows are two pages: the second waits for the client to read the first.
      const stream = kit.open(kit.acme, people.ada, { from: 'beginning', shownOnly: true });
      // Twenty rows of the first page are read: the page is still above half the buffer and the second waits.
      const told: string[] = [];
      while (told.length < 20) {
        const step = await stream.next();
        if (step.done === true) throw new Error('the stream ended at once');
        if ('event' in step.value) told.push(step.value.event.cardId);
      }
      const target = told[19];
      if (target === undefined) throw new Error('no card was told');
      const listener = attached[attached.length - 1];
      if (listener?.undecided === undefined) throw new Error('the subscriber attached no listener');

      // The reader's unit stays open after `undecided` has answered, until the test lets it close.
      const answer = listener.undecided.bind(listener);
      let armed = true;
      let holding = false;
      let reached: () => void = () => undefined;
      const atUndecided = new Promise<void>((resolve) => {
        reached = resolve;
      });
      let release: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      listener.undecided = (batch) => {
        const ids = answer(batch);
        if (armed) {
          armed = false;
          holding = true;
        }
        return ids;
      };
      const adapter = kit.runtime.adapter;
      const open = adapter.unit.bind(adapter);
      vi.spyOn(adapter, 'unit').mockImplementation(((namespace, scope, run, options) =>
        open(namespace, scope, run, options).then(async (result) => {
          if (holding) {
            holding = false;
            reached();
            await gate;
          }
          return result;
        })) as typeof adapter.unit);

      // A card the snapshot has told leaves the view (the set holds only three ids): the pass carrying it is the one held.
      await kit.write(kit.acme, 'board.card.update', { id: target, patch: { shown: false } });
      await atUndecided;

      // The start finishes while the unit is open, then the batch is delivered.
      const frames: LiveFrame<CardEvent>[] = [];
      for (;;) {
        const step = await stream.next();
        if (step.done === true) throw new Error('the stream ended before head');
        frames.push(step.value);
        if ('control' in step.value) break;
      }
      release();
      const removed = (): boolean =>
        frames.some(
          (frame) =>
            'event' in frame && frame.event.cardId === target && frame.event.type === 'removed',
        );
      while (!removed()) {
        const step = await stream.next();
        if (step.done === true) throw new Error('the stream ended');
        expect(step.value).not.toMatchObject({ control: 'reset' });
        frames.push(step.value);
      }
      expect(frames.filter((frame) => 'control' in frame && frame.control === 'reset')).toEqual([]);
      // What comes after the release: one more change to a card the stream shows is read, and no `reset` came before it.
      const shown = told[0];
      if (shown === undefined) throw new Error('no card was told');
      await kit.write(kit.acme, 'board.card.update', { id: shown, patch: { title: 'after' } });
      const changed = (): boolean =>
        frames.some(
          (frame) =>
            'event' in frame && frame.event.cardId === shown && frame.event.title === 'after',
        );
      while (!changed()) {
        const step = await stream.next();
        if (step.done === true) throw new Error('the stream ended');
        expect(step.value).not.toMatchObject({ control: 'reset' });
        frames.push(step.value);
      }
      await stream.return?.();
    } finally {
      await kit.stop();
    }
  });

  test('a pass that asked while the start was read and never delivered leaves no trace', async () => {
    const kit = await startBoard(
      'memory',
      recordingLive({ maxBufferedItems: 150, visibilityBound: 3 }).module,
    );
    try {
      for (let at = 0; at < 120; at += 1) {
        await kit.write(kit.acme, 'board.card.create', { owner: 'ada', title: `old ${at}` });
      }
      const stream = kit.open(kit.acme, people.ada, { from: 'beginning' });
      const first = await stream.next();
      if (first.done === true || !('event' in first.value)) throw new Error('no card was told');
      const shown = first.value.event.cardId;
      const listener = attached[attached.length - 1];
      const view = listener?.view;
      if (listener?.undecided === undefined || view === undefined) throw new Error('no listener');

      // The pass carried (0, 500000] and failed after it asked: it delivers nothing and keeps its position.
      listener.undecided({ ...unknownCard, to: 500_000n });
      for (;;) {
        const step = await stream.next();
        if (step.done === true) throw new Error('the stream ended before head');
        if ('control' in step.value) break;
      }
      // Its range comes again, in a batch that straddles the end of the first: the card changed on both sides.
      const events = [499_990n, 500_010n].map((position) => ({
        position,
        stream: { type: 'board.card', id: 'card_unknown' },
        type: 'board.card.changed',
        partition: null,
      }));
      const straddling = {
        from: 499_000n,
        to: 500_020n,
        events,
        rows: new Map([['board.card', new Map([['card_unknown', undefined]])]]),
        verdicts: new Map(),
        earlier: new Map([
          [
            planGroupKey(view),
            { asked: new Set(['card_unknown']), earlier: { rows: new Map(), uncertain: false } },
          ],
        ]),
      } as unknown as ReaderBatch;
      listener.deliver(straddling);
      await kit.write(kit.acme, 'board.card.update', { id: shown, patch: { title: 'after' } });
      const frames: LiveFrame<CardEvent>[] = [];
      for (;;) {
        const step = await stream.next();
        if (step.done === true) throw new Error('the stream ended');
        expect(step.value).not.toMatchObject({ control: 'reset' });
        frames.push(step.value);
        if ('event' in step.value && step.value.event.cardId === shown) break;
      }
      await stream.return?.();
    } finally {
      await kit.stop();
    }
  });
});
