import type { LiveFrame } from '@keelwerk/core';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { Adapter, BoardKit, CardEvent } from './support/live-kit.ts';
import { lastState, people, startBoard } from './support/live-kit.ts';

const events = (frames: readonly LiveFrame<CardEvent>[]): CardEvent[] =>
  frames.flatMap((frame) => ('event' in frame ? [frame.event] : []));

describe.each(['memory', 'pglite'] as const)(
  'a resumed live stream follows with a partial set on %s',
  (adapter: Adapter) => {
    let kit: BoardKit;
    beforeAll(async () => {
      kit = await startBoard(adapter);
    });
    afterAll(async () => {
      await kit.stop();
    });

    const card = (over: Record<string, unknown> = {}) =>
      kit.write<{ id: string }>(kit.acme, 'board.card.create', {
        owner: 'ada',
        title: 'card',
        ...over,
      });

    /** Subscribes as `who`, lets the stream catch up, and answers what it was told with the last token. */
    async function connect(who = people.ada) {
      const stream = kit.subscribe(kit.acme, who);
      await stream.ready();
      return { stream, token: lastState(stream.frames) };
    }

    test('a resumed stream (a partial set) is told in the batch of a card that left its view, and of no card it never could read', async () => {
      const mine = await card({ title: 'mine' });
      const { stream, token } = await connect();
      await stream.stop();
      const resumed = kit.subscribe(kit.acme, people.ada, {}, token as never);
      try {
        await resumed.ready();
        const hidden = await card({ owner: 'bob', title: 'hidden' });
        await kit.write(kit.acme, 'board.card.update', { id: hidden.id, patch: { title: 'edit' } });
        // The card moves to another owner while the stream is connected: the set never held it.
        await kit.write(kit.acme, 'board.card.update', { id: mine.id, patch: { owner: 'bob' } });
        await resumed.until((frames) => events(frames).some((event) => event.cardId === mine.id));
        expect(events(resumed.frames)).toEqual([
          { type: 'removed', cardId: mine.id, reason: 'left-view' },
        ]);
        expect(JSON.stringify(resumed.frames)).not.toContain(hidden.id);
      } finally {
        await resumed.stop();
      }
    });

    test('a resumed stream that names ids is not disturbed by the changes of other cards, and a related change it cannot judge resets', async () => {
      // Eve reads the cards of the decks she owns.
      const watched = await card({ owner: 'x', title: 'watched' });
      const deck = await kit.write<{ id: string }>(kit.acme, 'board.deck.create', {
        owner: 'eve',
        cardId: watched.id,
      });
      const first = kit.subscribe(kit.acme, people.eve, { ids: [watched.id] });
      await first.ready();
      const token = lastState(first.frames);
      await first.stop();
      const resumed = kit.subscribe(kit.acme, people.eve, { ids: [watched.id] }, token as never);
      try {
        await resumed.ready();
        // Another card changes through a deck eve owns: it is not in her ids, so nothing is asked about it.
        const other = await card({ owner: 'x', title: 'other' });
        await kit.write(kit.acme, 'board.deck.create', { owner: 'eve', cardId: other.id });
        await kit.write(kit.acme, 'board.card.update', { id: other.id, patch: { title: 'again' } });
        await new Promise((resolve) => setTimeout(resolve, 300));
        expect(resumed.ended()).toBe(false);
        expect(events(resumed.frames)).toEqual([]);
        // Her card leaves her view together with its deck: the evidence does not suffice.
        await kit.call(kit.acme, people.eve, 'board.handOver', {
          cardId: watched.id,
          deckId: deck.id,
          owner: 'bob',
          title: 'moved',
        });
        await resumed.until(() => resumed.ended());
        expect(resumed.frames.at(-1)).toEqual({ control: 'reset', reason: 'resync' });
      } finally {
        await resumed.stop();
      }
    });
  },
);
