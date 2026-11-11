import type { LiveFrame } from '@keelwerk/core';
import { errors } from '@keelwerk/core';
import { testCarrier } from '@keelwerk/testing';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import type { Adapter, BoardKit, CardEvent } from './support/live-kit.ts';
import { people, startBoard } from './support/live-kit.ts';
import { smallHubs, smallLive } from './support/small-live-module.ts';

const events = (frames: readonly LiveFrame<CardEvent>[]): CardEvent[] =>
  frames.flatMap((frame) => ('event' in frame ? [frame.event] : []));

describe.each(['memory', 'pglite'] as const)('a small hub on %s', (adapter: Adapter) => {
  let kit: BoardKit;
  /** The hub of this runtime: the last one the filler opened. */
  const hubOf = () => {
    const hub = smallHubs.at(-1);
    if (hub === undefined) throw new Error('the runtime opened no hub');
    return hub;
  };
  beforeAll(async () => {
    kit = await startBoard(adapter, smallLive);
  });
  afterAll(async () => {
    await kit.stop();
  });

  const card = (over: Record<string, unknown> = {}) =>
    kit.write<{ id: string }>(kit.acme, 'board.card.create', { owner: 'ada', title: 'c', ...over });

  test('a saturated set judges a row it does not hold: lost is removed, never readable is omitted', async () => {
    const stream = kit.subscribe(kit.acme, people.ada);
    try {
      await stream.ready();
      const made: string[] = [];
      for (let at = 0; at < 5; at += 1) made.push((await card({ title: `c${at}` })).id);
      await stream.until((frames) => events(frames).length >= 5);
      // The set holds three ids; the last two cards are known to the subscriber but not to the set.
      const unheld = made[4] ?? '';
      const held = made[0] ?? '';
      const hidden = await card({ owner: 'bob' });
      await kit.write(kit.acme, 'board.card.update', { id: hidden.id, patch: { title: 'edit' } });
      await kit.write(kit.acme, 'board.card.update', { id: unheld, patch: { owner: 'bob' } });
      await kit.write(kit.acme, 'board.card.update', { id: held, patch: { owner: 'bob' } });
      await stream.until((frames) => events(frames).length >= 7);
      const removed = events(stream.frames)
        .filter((event) => event.type === 'removed')
        .map((event) => event.cardId);
      expect(removed.sort()).toEqual([held, unheld].sort());
      expect(JSON.stringify(stream.frames)).not.toContain(hidden.id);
    } finally {
      await stream.stop();
    }
  });

  test('the hub lists its subscriptions; fail ends one with the error, renew with another plan resets it', async () => {
    const watching = kit.subscribe(kit.acme, people.ada);
    const failing = kit.subscribe(kit.acme, people.ada);
    try {
      await watching.ready();
      await failing.ready();
      const listed = hubOf().subscriptions();
      expect(listed.length).toBeGreaterThanOrEqual(2);
      const [first, second] = listed.slice(-2);
      if (first === undefined || second === undefined) throw new Error('two subscriptions listed');
      // The same session renews without any frame.
      await first.renew(first.session);
      // A session of another principal has another plan: the stream resynchronises.
      const opened = await kit.invoker.open(testCarrier(kit.acme, people.bob));
      if (!opened.ok) throw opened.error;
      await first.renew(opened.value);
      const resetOf = () =>
        [watching, failing].filter((one) =>
          one.frames.some((frame) => 'control' in frame && frame.control === 'reset'),
        );
      await vi.waitFor(() => expect(resetOf()).toHaveLength(1));
      const resets = resetOf();
      // `fail` ends the other with its error.
      const survivor = resets[0] === watching ? failing : watching;
      second.fail(errors.unauthenticated('The credentials ended.'));
      await survivor.until(() => survivor.ended());
      expect(survivor.failure()).toMatchObject({ kind: 'unauthenticated' });
    } finally {
      await watching.stop();
      await failing.stop();
    }
  });

  test('a partial set that cannot judge a related change resets resync and ends the stream', async () => {
    // eve reads the cards of the decks she owns: a rule over a relation, so a deck change decides who sees a card.
    const cards: string[] = [];
    const decks: string[] = [];
    for (let at = 0; at < 4; at += 1) {
      const made = await card({ owner: 'x', title: `d${at}` });
      const deck = await kit.write<{ id: string }>(kit.acme, 'board.deck.create', {
        owner: 'eve',
        cardId: made.id,
      });
      cards.push(made.id);
      decks.push(deck.id);
    }
    const stream = kit.subscribe(kit.acme, people.eve, { from: 'beginning' });
    try {
      await stream.ready();
      // Four cards, a set of three: the last card is known to eve but not held by the set.
      await stream.until((frames) => events(frames).length >= 4);
      const unheld = cards[3] ?? '';
      const deck = decks[3] ?? '';
      await kit.call(kit.acme, people.eve, 'board.handOver', {
        cardId: unheld,
        deckId: deck,
        owner: 'bob',
        title: 'moved',
      });
      await stream.until(() => stream.ended());
      expect(stream.frames.slice(4).filter((frame) => 'event' in frame)).toEqual([]);
      expect(stream.frames.at(-1)).toEqual({ control: 'reset', reason: 'resync' });
    } finally {
      await stream.stop();
    }
  });
});
