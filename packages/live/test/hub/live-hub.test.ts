import type { LiveFrame } from '@keelwerk/core';
import { decodeStateToken } from '@keelwerk/core';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { Adapter, BoardKit, CardEvent, Collected } from './support/live-kit.ts';
import { people, startBoard } from './support/live-kit.ts';

const events = (frames: readonly LiveFrame<CardEvent>[]): CardEvent[] =>
  frames.flatMap((frame) => ('event' in frame ? [frame.event] : []));

const positionOf = (frame: LiveFrame<CardEvent>): bigint =>
  decodeStateToken(String('state' in frame ? frame.state : '')).position;

/** Waits until the stream has delivered an item for the card, then returns what it has so far. */
async function seen(stream: Collected, cardId: string, count = 1): Promise<void> {
  await stream.until(
    (frames) => events(frames).filter((event) => event.cardId === cardId).length >= count,
  );
}

describe.each(['memory', 'pglite'] as const)('the live hub on %s', (adapter: Adapter) => {
  let kit: BoardKit;
  beforeAll(async () => {
    kit = await startBoard(adapter);
  });
  afterAll(async () => {
    await kit.stop();
  });

  const card = (tenant = kit.acme, over: Record<string, unknown> = {}) =>
    kit.write<{ id: string }>(tenant, 'board.card.create', {
      owner: 'ada',
      title: 'card',
      ...over,
    });

  test('from beginning emits the current rows, a head, then changed items with version and cause', async () => {
    const first = await card(kit.acme, { title: 'one', note: 'secret' });
    const stream = kit.subscribe(kit.acme, people.ada, { from: 'beginning' });
    try {
      await stream.ready();
      const [row, head] = stream.frames;
      expect(row).toMatchObject({ event: { type: 'changed', cardId: first.id, title: 'one' } });
      expect(head).toMatchObject({ control: 'head' });
      await kit.write(kit.acme, 'board.card.update', { id: first.id, patch: { title: 'two' } });
      await stream.until((frames) => frames.length >= 3);
      expect(stream.frames[2]).toMatchObject({
        event: { type: 'changed', cardId: first.id, version: 2, title: 'two', cause: 'changed' },
        state: expect.stringMatching(/^v2\./),
      });
    } finally {
      await stream.stop();
    }
  });

  test('acme subscribers never receive, count or get tokens of globex writes, also in a mixed batch', async () => {
    const acme = kit.subscribe(kit.acme, people.ada);
    const globex = kit.subscribe(kit.globex, people.ada);
    try {
      await acme.ready();
      await globex.ready();
      // Interleaved writes of both tenants, so every wake-up names both scopes.
      const mine: string[] = [];
      const theirs: string[] = [];
      for (let round = 0; round < 3; round += 1) {
        theirs.push((await card(kit.globex, { title: `g${round}` })).id);
        mine.push((await card(kit.acme, { title: `a${round}` })).id);
        theirs.push((await card(kit.globex, { title: `g${round}b` })).id);
      }
      await seen(acme, mine[2] ?? '');
      await seen(globex, theirs[5] ?? '');
      const acmeEvents = events(acme.frames);
      expect(acmeEvents.map((event) => event.cardId).sort()).toEqual([...mine].sort());
      expect(JSON.stringify(acme.frames)).not.toContain('"g0"');
      expect(
        events(globex.frames)
          .map((event) => event.cardId)
          .sort(),
      ).toEqual([...theirs].sort());
      const scopeOf = (frames: readonly LiveFrame<CardEvent>[]): Set<string> =>
        new Set(
          frames.flatMap((frame) =>
            'state' in frame && frame.state !== undefined
              ? [decodeStateToken(String(frame.state)).scope]
              : [],
          ),
        );
      const acmeScopes = scopeOf(acme.frames);
      expect(acmeScopes.size).toBe(1);
      expect([...scopeOf(globex.frames)].some((scope) => acmeScopes.has(scope))).toBe(false);
    } finally {
      await acme.stop();
      await globex.stop();
    }
  });

  test('a row leaving the filter is removed left-view', async () => {
    const stream = kit.subscribe(kit.acme, people.ada, { shownOnly: true });
    try {
      await stream.ready();
      const made = await card();
      await seen(stream, made.id);
      await kit.write(kit.acme, 'board.card.update', { id: made.id, patch: { shown: false } });
      await seen(stream, made.id, 2);
      expect(events(stream.frames).filter((event) => event.cardId === made.id)).toMatchObject([
        { type: 'created' },
        { type: 'removed', reason: 'left-view' },
      ]);
    } finally {
      await stream.stop();
    }
  });

  test('a row leaving the plan is removed left-view', async () => {
    const stream = kit.subscribe(kit.acme, people.ada);
    try {
      await stream.ready();
      const made = await card();
      await seen(stream, made.id);
      await kit.write(kit.acme, 'board.card.update', { id: made.id, patch: { owner: 'bob' } });
      await seen(stream, made.id, 2);
      expect(events(stream.frames).filter((event) => event.cardId === made.id)).toMatchObject([
        { type: 'created' },
        { type: 'removed', reason: 'left-view' },
      ]);
    } finally {
      await stream.stop();
    }
  });

  test('a row the subscriber never saw is never mentioned when it changes or leaves', async () => {
    const stream = kit.subscribe(kit.acme, people.ada);
    try {
      await stream.ready();
      const hidden = await card(kit.acme, { owner: 'bob', title: 'hidden' });
      await kit.write(kit.acme, 'board.card.update', { id: hidden.id, patch: { title: 'edit' } });
      await kit.write(kit.acme, 'board.card.update', { id: hidden.id, patch: { shown: false } });
      await kit.write(kit.acme, 'board.card.archive', { id: hidden.id });
      const mine = await card();
      await seen(stream, mine.id);
      expect(JSON.stringify(stream.frames)).not.toContain(hidden.id);
      expect(events(stream.frames).map((event) => event.cardId)).toEqual([mine.id]);
    } finally {
      await stream.stop();
    }
  });

  test('a viewer gets the note in $masked, an owner gets the note', async () => {
    const stream = kit.subscribe(kit.acme, people.vic);
    const owner = kit.subscribe(kit.acme, people.ada);
    try {
      await stream.ready();
      await owner.ready();
      const made = await card(kit.acme, { note: 'private' });
      await seen(stream, made.id);
      await seen(owner, made.id);
      const [viewed] = events(stream.frames).filter((event) => event.cardId === made.id);
      expect(viewed).toMatchObject({ type: 'created', masked: 'note' });
      expect(viewed?.note).toBeUndefined();
      expect(JSON.stringify(stream.frames)).not.toContain('private');
      const [owned] = events(owner.frames).filter((event) => event.cardId === made.id);
      expect(owned).toMatchObject({ note: 'private' });
      expect(owned?.masked).toBeUndefined();
    } finally {
      await stream.stop();
      await owner.stop();
    }
  });

  test('items are in position order with increasing tokens', async () => {
    const stream = kit.subscribe(kit.acme, people.ada);
    try {
      await stream.ready();
      const ids: string[] = [];
      for (let at = 0; at < 6; at += 1) ids.push((await card()).id);
      await kit.write(kit.acme, 'board.card.update', { id: ids[0], patch: { title: 'again' } });
      await stream.until((frames) => events(frames).length >= 7);
      const positions = stream.frames.map(positionOf);
      for (let at = 1; at < positions.length; at += 1) {
        expect(positions[at] ?? 0n).toBeGreaterThan(positions[at - 1] ?? 0n);
      }
      expect(events(stream.frames).map((event) => event.cardId)).toEqual([...ids, ids[0]]);
    } finally {
      await stream.stop();
    }
  });

  test('an archived row is archived without a row unless includeArchived', async () => {
    const plain = kit.subscribe(kit.acme, people.ada);
    const all = kit.subscribe(kit.acme, people.ada, { includeArchived: true });
    try {
      await plain.ready();
      await all.ready();
      const made = await card(kit.acme, { title: 'to archive' });
      await seen(plain, made.id);
      await seen(all, made.id);
      await kit.write(kit.acme, 'board.card.archive', { id: made.id });
      await seen(plain, made.id, 2);
      await seen(all, made.id, 2);
      const [, gone] = events(plain.frames).filter((event) => event.cardId === made.id);
      expect(gone).toMatchObject({ type: 'archived' });
      expect(gone?.title).toBeUndefined();
      const [, kept] = events(all.frames).filter((event) => event.cardId === made.id);
      expect(kept).toMatchObject({ type: 'archived', title: 'to archive' });
    } finally {
      await plain.stop();
      await all.stop();
    }
  });
});
