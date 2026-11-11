import type { LiveFrame } from '@keelwerk/core';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { Adapter, BoardKit, CardEvent, Collected } from './support/live-kit.ts';
import { boardVersions, lastState, people, startBoard } from './support/live-kit.ts';

const events = (frames: readonly LiveFrame<CardEvent>[]): CardEvent[] =>
  frames.flatMap((frame) => ('event' in frame ? [frame.event] : []));

describe.each(['memory', 'pglite'] as const)('resuming a live stream on %s', (adapter: Adapter) => {
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
  async function connect(who = people.ada): Promise<{ stream: Collected; token: string }> {
    const stream = kit.subscribe(kit.acme, who);
    await stream.ready();
    return { stream, token: lastState(stream.frames) };
  }

  test('resume from the last token on a fresh reader (all subscribers gone) gives every later change, no gap', async () => {
    const { stream, token } = await connect();
    const seen = await card({ title: 'seen' });
    await stream.until((frames) => events(frames).some((event) => event.cardId === seen.id));
    const resumeFrom = lastState(stream.frames);
    await stream.stop();
    // Nobody is subscribed: the reader of the scope has stopped.
    const missed = [await card({ title: 'm1' }), await card({ title: 'm2' })];
    const resumed = kit.subscribe(kit.acme, people.ada, {}, resumeFrom);
    try {
      await resumed.ready();
      const live = await card({ title: 'live' });
      await resumed.until((frames) => events(frames).some((event) => event.cardId === live.id));
      expect(events(resumed.frames).map((event) => event.cardId)).toEqual([
        ...missed.map((made) => made.id),
        live.id,
      ]);
      const head = resumed.frames.findIndex((frame) => 'control' in frame);
      expect(head).toBe(2);
      expect(token).toBeDefined();
    } finally {
      await resumed.stop();
    }
  });

  test('a resumed stream replays under current permissions', async () => {
    const mine = await card({ title: 'a' });
    const { stream, token } = await connect();
    await stream.stop();
    for (const title of ['b', 'c']) {
      await kit.write(kit.acme, 'board.card.update', { id: mine.id, patch: { title } });
    }
    const resumed = kit.subscribe(kit.acme, people.ada, {}, token as never);
    try {
      await resumed.ready();
      // The current row, once: not the history of its titles.
      expect(events(resumed.frames)).toMatchObject([
        { type: 'changed', cardId: mine.id, title: 'c', version: 3 },
      ]);
    } finally {
      await resumed.stop();
    }
  });

  test('a row lost while disconnected is removed, a row never readable is omitted (15.2.6 step 4)', async () => {
    const mine = await card({ title: 'mine' });
    const { stream, token } = await connect();
    await stream.stop();
    await kit.write(kit.acme, 'board.card.update', { id: mine.id, patch: { owner: 'bob' } });
    const hidden = await card({ owner: 'bob', title: 'hidden' });
    await kit.write(kit.acme, 'board.card.update', { id: hidden.id, patch: { title: 'edit' } });
    const resumed = kit.subscribe(kit.acme, people.ada, {}, token as never);
    try {
      await resumed.ready();
      expect(events(resumed.frames)).toEqual([
        { type: 'removed', cardId: mine.id, reason: 'left-view' },
      ]);
      expect(JSON.stringify(resumed.frames)).not.toContain(hidden.id);
    } finally {
      await resumed.stop();
    }
  });

  test('an archived row is archived without a row on a resume, with its row when archived rows are followed (D6)', async () => {
    const made = await card({ title: 'to archive' });
    const plain = await connect();
    await plain.stream.stop();
    const following = kit.subscribe(kit.acme, people.ada, { includeArchived: true });
    await following.ready();
    const followingToken = lastState(following.frames);
    await following.stop();
    await kit.write(kit.acme, 'board.card.archive', { id: made.id });
    const resumedPlain = kit.subscribe(kit.acme, people.ada, {}, plain.token as never);
    const resumedFollowing = kit.subscribe(
      kit.acme,
      people.ada,
      { includeArchived: true },
      followingToken as never,
    );
    try {
      await resumedPlain.ready();
      await resumedFollowing.ready();
      expect(events(resumedPlain.frames)).toEqual([
        { type: 'archived', cardId: made.id, version: expect.any(Number) },
      ]);
      expect(events(resumedFollowing.frames)).toEqual([
        { type: 'archived', cardId: made.id, version: expect.any(Number), title: 'to archive' },
      ]);
    } finally {
      await resumedPlain.stop();
      await resumedFollowing.stop();
    }
  });

  test('an archived row that is purged while disconnected is removed as purged for a subscriber that follows archived rows, once', async () => {
    const made = await card({ title: 'to purge' });
    await kit.write(kit.acme, 'board.card.archive', { id: made.id });
    const following = kit.subscribe(kit.acme, people.ada, { includeArchived: true });
    await following.ready();
    const followingToken = lastState(following.frames);
    await following.stop();
    // A change while disconnected, so the stream has events after the token; then the row is purged.
    await kit.write(kit.acme, 'board.card.restore', { id: made.id });
    await kit.write(kit.acme, 'board.card.archive', { id: made.id });
    const { runtime } = kit;
    const descriptor = runtime.app.registry.entities.get('board.card')?.descriptor;
    if (descriptor === undefined) throw new Error('the board has a card entity');
    const purged = await runtime.sealed.unit(
      runtime.namespace,
      { level: 'tenant', backendId: runtime.backendId, tenantId: kit.acme.id },
      (unit) => unit.rows.purge(descriptor, [made.id]),
    );
    expect(purged).toBe(1);
    const resumed = kit.subscribe(
      kit.acme,
      people.ada,
      { includeArchived: true },
      followingToken as never,
    );
    try {
      await resumed.ready();
      expect(events(resumed.frames)).toEqual([
        { type: 'removed', cardId: made.id, reason: 'purged' },
      ]);
    } finally {
      await resumed.stop();
    }
  });

  test('a quantifier rule with a related change while disconnected sends reset resync', async () => {
    const { stream, token } = await connect(people.eve);
    await stream.stop();
    const made = await card({ owner: 'x' });
    await kit.write(kit.acme, 'board.deck.create', { owner: 'eve', cardId: made.id });
    const resumed = kit.subscribe(kit.acme, people.eve, {}, token as never);
    try {
      await resumed.until((frames) => frames.length >= 1);
      expect(resumed.frames).toEqual([{ control: 'reset', reason: 'resync' }]);
      await resumed.until(() => resumed.ended());
    } finally {
      await resumed.stop();
    }
  });

  test('a token of another principal or selector resynchronises and delivers nothing', async () => {
    const { stream, token } = await connect(people.ada);
    await stream.stop();
    const other = kit.subscribe(kit.acme, people.bob, {}, token as never);
    const narrower = kit.subscribe(kit.acme, people.ada, { shownOnly: true }, token as never);
    try {
      for (const resumed of [other, narrower]) {
        await resumed.until((frames) => frames.length >= 1);
        expect(resumed.frames).toEqual([{ control: 'reset', reason: 'resync' }]);
      }
      await card({ owner: 'bob', title: 'for bob' });
      expect(other.frames).toHaveLength(1);
    } finally {
      await other.stop();
      await narrower.stop();
    }
  });

  test('a token of other ids or of another API version resynchronises and delivers nothing', async () => {
    const first = await card({ title: 'first' });
    const second = await card({ title: 'second' });
    const head = kit.subscribe(kit.acme, people.ada, { ids: [first.id] });
    await head.ready();
    const idsToken = lastState(head.frames);
    await head.stop();
    const plain = await connect(people.ada);
    await plain.stream.stop();
    const widerIds = kit.subscribe(kit.acme, people.ada, { ids: [second.id] }, idsToken as never);
    const olderVersion = kit.subscribe(
      kit.acme,
      people.ada,
      {},
      plain.token as never,
      boardVersions.older,
    );
    try {
      for (const resumed of [widerIds, olderVersion]) {
        await resumed.until((frames) => frames.length >= 1);
        expect(resumed.frames).toEqual([{ control: 'reset', reason: 'resync' }]);
      }
      // A stream that is attached sees the write: by then the reset ones have had their chance to deliver it.
      const sentinel = kit.subscribe(kit.acme, people.ada);
      try {
        await sentinel.ready();
        const later = await card({ title: 'later' });
        await sentinel.until((frames) => events(frames).some((event) => event.cardId === later.id));
      } finally {
        await sentinel.stop();
      }
      expect(widerIds.frames).toHaveLength(1);
      expect(olderVersion.frames).toHaveLength(1);
    } finally {
      await widerIds.stop();
      await olderVersion.stop();
    }
  });

  test('a token of another tenant is core.token_scope_mismatch', async () => {
    const { stream, token } = await connect(people.ada);
    await stream.stop();
    const foreign = kit.subscribe(kit.globex, people.ada, {}, token as never);
    try {
      await foreign.until(() => foreign.ended());
      expect(foreign.failure()?.code).toBe('core.token_scope_mismatch');
      expect(foreign.frames).toEqual([]);
    } finally {
      await foreign.stop();
    }
  });

  test('query then watch after its queryState is gap free', async () => {
    await card({ title: 'before' });
    const page = await kit.call<{ queryState: string; items: { id: string }[] }>(
      kit.acme,
      people.ada,
      'board.card.query',
      {},
    );
    const between = await card({ title: 'between' });
    const resumed = kit.subscribe(kit.acme, people.ada, {}, page.queryState as never);
    try {
      await resumed.ready();
      const after = await card({ title: 'after' });
      await resumed.until((frames) => events(frames).some((event) => event.cardId === after.id));
      expect(events(resumed.frames).map((event) => event.cardId)).toEqual([between.id, after.id]);
      expect(page.items.some((item) => item.id === between.id)).toBe(false);
    } finally {
      await resumed.stop();
    }
  });
  test('query with a filter, then a watch with the same filter after its queryState, is gap free', async () => {
    await card({ title: 'before' });
    const page = await kit.call<{ queryState: string; items: { id: string }[] }>(
      kit.acme,
      people.ada,
      'board.card.query',
      { filter: { shown: true } },
    );
    const between = await card({ title: 'between' });
    const resumed = kit.subscribe(
      kit.acme,
      people.ada,
      { shownOnly: true },
      page.queryState as never,
    );
    try {
      await resumed.ready();
      const after = await card({ title: 'after' });
      await resumed.until((frames) => events(frames).some((event) => event.cardId === after.id));
      expect(events(resumed.frames).map((event) => event.cardId)).toEqual([between.id, after.id]);
    } finally {
      await resumed.stop();
    }
  });

  test('get then a filtered watch after its state is gap free', async () => {
    const made = await card({ title: 'got' });
    const got = await kit.call<{ state: string }>(kit.acme, people.ada, 'board.card.get', {
      ids: [made.id],
    });
    const between = await card({ title: 'between' });
    const resumed = kit.subscribe(kit.acme, people.ada, { shownOnly: true }, got.state as never);
    try {
      await resumed.ready();
      const after = await card({ title: 'after' });
      await resumed.until((frames) => events(frames).some((event) => event.cardId === after.id));
      expect(events(resumed.frames).map((event) => event.cardId)).toEqual([between.id, after.id]);
    } finally {
      await resumed.stop();
    }
  });
});
