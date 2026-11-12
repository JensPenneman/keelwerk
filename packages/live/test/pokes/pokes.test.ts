import type { LiveFrame, StateToken } from '@keelwerk/core';
import { testCarrier, testPrincipal } from '@keelwerk/testing';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import type { Adapter, BoardKit } from '../hub/support/live-kit.ts';
import { people, startBoard } from '../hub/support/live-kit.ts';
import { attachPokes as attachPokesTo, pokes, pokesNaming } from '../support/attach-pokes.ts';
import { collectFrames } from '../support/collect-frames.ts';
import { adaPrincipal, startLiveApp } from '../support/live-app-kit.ts';

vi.setConfig({ testTimeout: 60_000 });

/** The pokes that name the entity type of the cards. */
const named = (frames: readonly LiveFrame<unknown>[]) => pokesNaming(frames, 'board.card');

const attachPokes = (
  stream: Parameters<typeof attachPokesTo>[0],
  probe: () => Promise<unknown>,
): Promise<number> => attachPokesTo(stream, 'board.card', probe);

describe.each(['memory', 'pglite'] as const)('live.pokes on %s', (adapter: Adapter) => {
  let kit: BoardKit;
  beforeAll(async () => {
    kit = await startBoard(adapter);
  });
  afterAll(async () => {
    await kit.stop();
  });

  const follow = (tenant = kit.acme, who = people.ada, after?: StateToken) =>
    collectFrames(
      kit.invoker.subscribe<unknown, unknown>(
        {
          action: 'live.pokes',
          input: {},
          carrier: testCarrier(tenant, who),
          requestId: crypto.randomUUID(),
          signal: new AbortController().signal,
        },
        after === undefined ? undefined : { after },
      ),
    );

  const card = (tenant = kit.acme, title = 'card') =>
    kit.write<{ id: string }>(tenant, 'board.card.create', { owner: 'ada', title });

  const attach = (stream: ReturnType<typeof follow>, tenant = kit.acme): Promise<number> =>
    attachPokes(stream, () => card(tenant, 'probe'));

  test('a write pokes its scope with the new state token of the entity type', async () => {
    const stream = follow();
    try {
      const base = await attach(stream);
      await card();
      await stream.until((frames) => named(frames).length > base);
      const poke = named(stream.frames)[base];
      expect(poke?.changed['board.card']).toMatch(/^v2\./);
      expect(poke?.upto).toMatch(/^v2\./);
      expect(stream.frames.some((frame) => 'control' in frame)).toBe(false);
    } finally {
      await stream.stop();
    }
  });

  test('the token of a poke is accepted by changes as since', async () => {
    const stream = follow();
    try {
      const base = await attach(stream);
      await card();
      await stream.until((frames) => named(frames).length > base);
      const token = named(stream.frames)[base]?.changed['board.card'];
      const answer = await kit.call<{ newState: string }>(
        kit.acme,
        people.ada,
        'board.card.changes',
        {
          since: token,
        },
      );
      expect(answer.newState).toMatch(/^v2\./);
    } finally {
      await stream.stop();
    }
  });

  test('a write in another tenant pokes nobody here', async () => {
    const here = follow(kit.acme);
    const there = follow(kit.globex);
    try {
      const hereBase = await attach(here);
      const thereBase = await attach(there, kit.globex);
      await card(kit.globex, 'elsewhere');
      await there.until((frames) => named(frames).length > thereBase);
      // A marker in this scope: the poke of the other tenant would have come before it.
      await card(kit.acme, 'marker');
      await here.until((frames) => named(frames).length > hereBase);
      expect(named(here.frames)).toHaveLength(hereBase + 1);
    } finally {
      await here.stop();
      await there.stop();
    }
  });

  test('resume from upto: nothing new is silent, a later write pokes', async () => {
    const first = follow();
    let upto: StateToken;
    try {
      const base = await attach(first);
      await card();
      await first.until((frames) => named(frames).length > base);
      upto = pokes(first.frames).at(-1)?.upto as StateToken;
    } finally {
      await first.stop();
    }
    const resumed = follow(kit.acme, people.ada, upto);
    try {
      await card(kit.acme, 'later');
      await resumed.until((frames) => pokes(frames).length > 0);
      // Nothing was sent at the join: the one poke is the one of the later write, past the token.
      // A poke at the join would name every entity type the principal reads; this one names what the write changed.
      expect(pokes(resumed.frames)).toHaveLength(1);
      expect(pokes(resumed.frames)[0]?.upto).not.toBe(upto);
      expect(Object.keys(pokes(resumed.frames)[0]?.changed ?? {})).toEqual(['board.card']);
    } finally {
      await resumed.stop();
    }
    // A resume behind the head names every entity type the principal may read.
    await card(kit.acme, 'missed');
    const behind = follow(kit.acme, people.ada, upto);
    try {
      await behind.until((frames) => pokes(frames).length > 0);
      const everything = Object.keys(pokes(behind.frames)[0]?.changed ?? {});
      expect(everything).toContain('board.card');
      // More than the cards: what tells a poke at the join from the poke of one write.
      expect(everything.length).toBeGreaterThan(1);
    } finally {
      await behind.stop();
    }
  });

  test('a token of another scope is refused and a malformed one is a validation error', async () => {
    const other = follow(kit.globex);
    let foreign: StateToken;
    try {
      await attach(other, kit.globex);
      foreign = pokes(other.frames)[0]?.upto as StateToken;
    } finally {
      await other.stop();
    }
    const mismatched = follow(kit.acme, people.ada, foreign);
    await expect(mismatched.until(() => false, 5000)).rejects.toThrow(/token_scope_mismatch/);
    const garbage = follow(kit.acme, people.ada, 'nonsense' as StateToken);
    await expect(garbage.until(() => false, 5000)).rejects.toThrow(/malformed_request/);
  });

  test('hub close ends the pokes stream without a frame', async () => {
    const own = await startBoard(adapter);
    try {
      const stream = collectFrames(
        own.invoker.subscribe<unknown, unknown>({
          action: 'live.pokes',
          input: {},
          carrier: testCarrier(own.acme, people.ada),
          requestId: crypto.randomUUID(),
          signal: new AbortController().signal,
        }),
      );
      await attachPokes(stream, () =>
        own.write(own.acme, 'board.card.create', { owner: 'ada', title: 'x' }),
      );
      const before = stream.frames.length;
      await own.stop();
      await stream.until(() => stream.ended());
      expect(stream.failure()).toBeUndefined();
      expect(stream.frames.length).toBe(before);
    } finally {
      await own.stop().catch(() => undefined);
    }
  });
});

const writer = testPrincipal('w', { claims: { seed: true } });

describe.each(['memory', 'pglite'] as const)('live.pokes with a pass on %s', (adapter: Adapter) => {
  test('an entity type the principal cannot read is never named', async () => {
    const kit = await startLiveApp(adapter);
    try {
      const stream = kit.follow(testCarrier(kit.acme, adaPrincipal), { action: 'live.pokes' });
      const base = await attachPokes(stream, () =>
        kit.call(kit.acme, writer, 'board.card.create', { owner: 'ada', title: 'probe' }),
      );
      // A pass is written first: ada reads no passes. The card after it is poked, so a poke of the pass would have come before.
      await kit.call(kit.acme, adaPrincipal, 'passes.issue', { holder: 'ada' });
      await kit.call(kit.acme, writer, 'board.card.create', { owner: 'ada', title: 'visible' });
      await stream.until((frames) => named(frames).length > base);
      const types = pokes(stream.frames).flatMap((poke) => Object.keys(poke.changed));
      expect(types).toContain('board.card');
      expect(types).not.toContain('passes.pass');
      await stream.stop();
    } finally {
      await kit.stop();
    }
  });

  test('a revoked session ends the pokes stream with unauthenticated', async () => {
    const kit = await startLiveApp(adapter);
    try {
      const pass = await kit.call<{ id: string; token: string }>(
        kit.acme,
        adaPrincipal,
        'passes.issue',
        { holder: 'ada' },
      );
      const followed = kit.follow(kit.bearer(kit.acme, pass.token), { action: 'live.pokes' });
      // A pass is a dependency of the session: the stream first needs to be attached.
      await attachPokes(followed, () =>
        kit.call(kit.acme, writer, 'board.card.create', { owner: 'ada', title: 'probe' }),
      );
      await kit.call(kit.acme, adaPrincipal, 'passes.revoke', { id: pass.id });
      await followed.until(() => followed.ended(), 5000);
      expect(followed.failure()).toMatchObject({ kind: 'unauthenticated' });
    } finally {
      await kit.stop();
    }
  });
});
