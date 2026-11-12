import type { LiveFrame } from '@keelwerk/core';
import { describe, expect, test, vi } from 'vitest';
import type { ReaderListener } from '../../src/hub/reader-listener.ts';
import { adaPrincipal, startLiveApp } from '../support/live-app-kit.ts';
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

/** The revalidation a test holds open: it waits on `wait` and tells `reached` when it began. */
const revalidation = vi.hoisted(() => ({
  wait: Promise.resolve() as Promise<void>,
  reached: (): void => undefined,
}));

vi.mock('../../src/hub/revalidate-sessions.ts', async (original) => {
  const real = await original<typeof import('../../src/hub/revalidate-sessions.ts')>();
  return {
    ...real,
    revalidateSessions: (...args: Parameters<typeof real.revalidateSessions>) => {
      const revalidator = real.revalidateSessions(...args);
      return {
        ...revalidator,
        revalidate: async (subscription: never) => {
          revalidation.reached();
          await revalidation.wait;
          return revalidator.revalidate(subscription);
        },
      };
    },
  };
});

vi.setConfig({ testTimeout: 60_000 });

describe('a subscriber whose start is still being read, and a batch held after it asked', () => {
  test('a card hidden while the start is read, then changed again while out of view, is not a resync', async () => {
    const kit = await startBoard(
      'memory',
      recordingLive({ maxBufferedItems: 150, visibilityBound: 3 }).module,
    );
    try {
      for (let at = 0; at < 120; at += 1) {
        await kit.write(kit.acme, 'board.card.create', { owner: 'ada', title: `old ${at}` });
      }
      // The snapshot's second page waits for the client, so the stream is still starting.
      const stream = kit.open(kit.acme, people.ada, { from: 'beginning', shownOnly: true });
      const told: string[] = [];
      while (told.length < 20) {
        const step = await stream.next();
        if (step.done === true) throw new Error('the stream ended at once');
        if ('event' in step.value) told.push(step.value.event.cardId);
      }
      const target = told[0];
      const other = told[1];
      if (target === undefined || other === undefined) throw new Error('no card was told');
      const listener = attached[attached.length - 1];
      if (listener?.undecided === undefined) throw new Error('the subscriber attached no listener');

      // The hide is delivered while the stream starts.
      const deliver = listener.deliver.bind(listener);
      let hidden: () => void = () => undefined;
      const hideDelivered = new Promise<void>((resolve) => {
        hidden = resolve;
      });
      listener.deliver = (batch) => {
        deliver(batch);
        if (batch.rows.get('board.card')?.get(target)?.shown === false) hidden();
      };
      await kit.write(kit.acme, 'board.card.update', { id: target, patch: { shown: false } });
      await hideDelivered;

      // The pass of the later change asks, and its unit stays open until the test lets it close.
      const answer = listener.undecided.bind(listener);
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
        if (batch.rows.get('board.card')?.get(target)?.title === 'while hidden') holding = true;
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
      await kit.write(kit.acme, 'board.card.update', {
        id: target,
        patch: { title: 'while hidden', shown: false },
      });
      await atUndecided;

      // The start finishes (its catch-up tells the hide and leaves the set) while that unit is open.
      const frames: LiveFrame<CardEvent>[] = [];
      for (;;) {
        const step = await stream.next();
        if (step.done === true) throw new Error('the stream ended before head');
        frames.push(step.value);
        if ('control' in step.value) break;
      }
      release();
      const head = frames.length;
      // The change to a card that is shown comes after the held batch: a reset would have come before it.
      await kit.write(kit.acme, 'board.card.update', { id: other, patch: { title: 'after' } });
      const changed = (): boolean =>
        frames.some(
          (frame) =>
            'event' in frame && frame.event.cardId === other && frame.event.title === 'after',
        );
      while (!changed()) {
        const step = await stream.next();
        if (step.done === true) throw new Error('the stream ended');
        expect(step.value).not.toMatchObject({ control: 'reset' });
        frames.push(step.value);
      }
      expect(frames.filter((frame) => 'control' in frame && frame.control === 'reset')).toEqual([]);
      // The held change of the hidden card is told neither as a second `removed` nor as a `changed`.
      expect(
        frames.slice(head).filter((frame) => 'event' in frame && frame.event.cardId === target),
      ).toEqual([]);
      await stream.return?.();
    } finally {
      await kit.stop();
    }
  });

  test('a change of a hidden card read while the session is revalidated is not a resync', async () => {
    const kit = await startLiveApp(
      'memory',
      recordingLive({ maxBufferedItems: 150, visibilityBound: 3 }).module,
    );
    try {
      const pass = await kit.call<{ id: string; token: string }>(
        kit.acme,
        adaPrincipal,
        'passes.issue',
        { holder: 'ada' },
      );
      const stream = kit.runtime.invoker
        .subscribe<unknown, CardEvent>({
          action: 'board.cards',
          input: { from: 'now', shownOnly: true },
          carrier: kit.bearer(kit.acme, pass.token),
          requestId: crypto.randomUUID(),
          signal: new AbortController().signal,
        })
        [Symbol.asyncIterator]();
      const frames: LiveFrame<CardEvent>[] = [];
      const pull = async (until: (frame: LiveFrame<CardEvent>) => boolean): Promise<void> => {
        for (;;) {
          const step = await stream.next();
          if (step.done === true) throw new Error('the stream ended');
          expect(step.value).not.toMatchObject({ control: 'reset' });
          frames.push(step.value);
          if (until(step.value)) return;
        }
      };
      await pull((frame) => 'control' in frame);

      // Four cards are told and the set holds three: it is partial, and it holds the first card.
      const ids: string[] = [];
      for (const title of ['x', 'y', 'z', 'w']) {
        const created = await kit.call<{ id: string }>(
          kit.acme,
          people.writer,
          'board.card.create',
          {
            owner: 'ada',
            title,
          },
        );
        ids.push(created.id);
      }
      const [target, other] = ids;
      if (target === undefined || other === undefined) throw new Error('no card was written');
      await pull((frame) => 'event' in frame && frame.event.cardId === ids[3]);

      // A change to the pass the session depends on holds the revalidation open.
      let began: () => void = () => undefined;
      const started = new Promise<void>((resolve) => {
        began = resolve;
      });
      let open: () => void = () => undefined;
      revalidation.wait = new Promise<void>((resolve) => {
        open = resolve;
      });
      revalidation.reached = began;
      const listener = attached[attached.length - 1];
      if (listener === undefined) throw new Error('the subscriber attached no listener');
      const deliver = listener.deliver.bind(listener);
      let delivered: () => void = () => undefined;
      const changeDelivered = new Promise<void>((resolve) => {
        delivered = resolve;
      });
      let hideDelivered: () => void = () => undefined;
      const hidden = new Promise<void>((resolve) => {
        hideDelivered = resolve;
      });
      let eventsOfTitleBatch = -1;
      listener.deliver = (batch) => {
        deliver(batch);
        const row = batch.rows.get('board.card')?.get(target);
        if (row?.shown === false && row.title !== 'while hidden') hideDelivered();
        if (row?.title === 'while hidden') {
          eventsOfTitleBatch = batch.events.filter((event) => event.stream.id === target).length;
          delivered();
        }
      };
      try {
        await kit.call(kit.acme, adaPrincipal, 'passes.label', { id: pass.id, label: 'held' });
        await started;
        // Held behind it: the hide of the card, then a change to it while it is out of view.
        await kit.call(kit.acme, people.writer, 'board.card.update', {
          id: target,
          patch: { shown: false },
        });
        await hidden;
        await kit.call(kit.acme, people.writer, 'board.card.update', {
          id: target,
          patch: { title: 'while hidden', shown: false },
        });
        await changeDelivered;
        // A merged batch of the hide and the change would pass without the fix: it fails here instead.
        expect(eventsOfTitleBatch).toBe(1);
      } finally {
        revalidation.wait = Promise.resolve();
        open();
      }
      await kit.call(kit.acme, people.writer, 'board.card.update', {
        id: other,
        patch: { title: 'after' },
      });
      await pull(
        (frame) =>
          'event' in frame && frame.event.cardId === other && frame.event.title === 'after',
      );
      // The hide is told once, as `removed`; the change to the hidden card is not told.
      expect(
        frames.flatMap((frame) =>
          'event' in frame && frame.event.cardId === target ? [frame.event.type] : [],
        ),
      ).toEqual(['created', 'removed']);
      await stream.return?.();
    } finally {
      await kit.stop();
    }
  });
});
