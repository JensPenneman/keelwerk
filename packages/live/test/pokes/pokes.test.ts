import type { LiveFrame, StateToken } from '@keelwerk/core';
import { testCarrier, testPrincipal } from '@keelwerk/testing';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import type { Adapter, BoardKit } from '../hub/support/live-kit.ts';
import { people, startBoard } from '../hub/support/live-kit.ts';
import type { JoinedPokes } from '../support/follow-pokes.ts';
import { followerOf, joinWatch } from '../support/follow-pokes.ts';
import { adaPrincipal, startLiveApp } from '../support/live-app-kit.ts';
import { pokes, pokesNaming } from '../support/poke-frames.ts';

vi.setConfig({ testTimeout: 60_000 });

/** The pokes that name the entity type of the cards. */
const named = (frames: readonly LiveFrame<unknown>[]) => pokesNaming(frames, 'board.card');

describe.each(['memory', 'pglite'] as const)('live.pokes on %s', (adapter: Adapter) => {
  const joins = joinWatch();
  let kit: BoardKit;
  beforeAll(async () => {
    kit = await startBoard(adapter, joins.live);
  });
  afterAll(async () => {
    await kit.stop();
  });

  /**
   * Follows the pokes of a tenant and answers once the reader has joined: a write after that is
   * poked.
   */
  const follow = (tenant = kit.acme, who = people.ada, after?: StateToken) =>
    joins.followPokes(followerOf(tenant, who), () =>
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

  test('a write pokes its scope with the new state token of the entity type', async () => {
    const stream = await follow();
    try {
      expect(stream.join).toBe('silent');
      await card();
      await stream.until((frames) => named(frames).length > 0);
      const poke = named(stream.frames)[0];
      expect(poke?.changed['board.card']).toMatch(/^v2\./);
      expect(poke?.upto).toMatch(/^v2\./);
      expect(stream.frames.some((frame) => 'control' in frame)).toBe(false);
    } finally {
      await stream.stop();
    }
  });

  test('the token of a poke is accepted by changes as since', async () => {
    const stream = await follow();
    try {
      await card();
      await stream.until((frames) => named(frames).length > 0);
      const token = named(stream.frames)[0]?.changed['board.card'];
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
    const here = await follow(kit.acme);
    const there = await follow(kit.globex);
    try {
      await card(kit.globex, 'elsewhere');
      await there.until((frames) => named(frames).length > 0);
      // A marker in this scope: the poke of the other tenant would have come before it.
      await card(kit.acme, 'marker');
      await here.until((frames) => named(frames).length > 0);
      expect(named(here.frames)).toHaveLength(1);
    } finally {
      await here.stop();
      await there.stop();
    }
  });

  /** The state token a first stream was poked up to by one card. */
  async function tokenAfterOneCard(): Promise<StateToken> {
    const first = await follow();
    try {
      await card();
      await first.until((frames) => named(frames).length > 0);
      return pokes(first.frames).at(-1)?.upto as StateToken;
    } finally {
      await first.stop();
    }
  }

  test('resume from upto: nothing new is silent at the join, a later write pokes', async () => {
    const upto = await tokenAfterOneCard();
    const resumed = await follow(kit.acme, people.ada, upto);
    try {
      // The reader joined and sent nothing for the gap: no write came between the token and the
      // head.
      expect(resumed.join).toBe('silent');
      await card(kit.acme, 'later');
      await resumed.until((frames) => pokes(frames).length > 0);
      // The one poke is the one of the later write, past the token, and names what the write
      // changed.
      expect(pokes(resumed.frames)).toHaveLength(1);
      expect(pokes(resumed.frames)[0]?.upto).not.toBe(upto);
      expect(Object.keys(pokes(resumed.frames)[0]?.changed ?? {})).toEqual(['board.card']);
    } finally {
      await resumed.stop();
    }
  });

  test('resume from behind the head: a write before the follow names every entity type', async () => {
    const upto = await tokenAfterOneCard();
    // The write comes first, so no barrier is needed: the join finds the head ahead of the token.
    await card(kit.acme, 'missed');
    const behind = await follow(kit.acme, people.ada, upto);
    try {
      expect(behind.join).toBe('poked');
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
    const other = await follow(kit.globex);
    let foreign: StateToken;
    try {
      await card(kit.globex, 'elsewhere');
      await other.until((frames) => pokes(frames).length > 0);
      foreign = pokes(other.frames)[0]?.upto as StateToken;
    } finally {
      await other.stop();
    }
    // Both are refused when the subscription is set up: the stream ends before its reader joins.
    const mismatched = await follow(kit.acme, people.ada, foreign);
    expect(mismatched.join).toBe('ended');
    await mismatched.whenEnded();
    expect(mismatched.failure()?.code).toMatch(/token_scope_mismatch/);
    const garbage = await follow(kit.acme, people.ada, 'nonsense' as StateToken);
    expect(garbage.join).toBe('ended');
    await garbage.whenEnded();
    expect(garbage.failure()?.code).toMatch(/malformed_request/);
  });

  test('a token of a reader with another plan ends the stream at the join with reset resync', async () => {
    // Vic reads every shown card and ada her own: the same scope, but not the same token.
    const vic = await follow(kit.acme, people.vic);
    let theirs: StateToken;
    try {
      await card(kit.acme, 'for vic');
      await vic.until((frames) => pokes(frames).length > 0);
      theirs = pokes(vic.frames)[0]?.upto as StateToken;
    } finally {
      await vic.stop();
    }
    const resumed = await follow(kit.acme, people.ada, theirs);
    // The token is accepted at the set-up and judged at the join: the join ends the stream.
    expect(resumed.join).toBe('ended');
    await resumed.whenEnded();
    expect(resumed.frames).toEqual([{ control: 'reset', reason: 'resync' }]);
    expect(resumed.failure()).toBeUndefined();
  });

  test('a second follow of one follower before the first has joined is refused', async () => {
    // Eve is followed by no other case: whatever this case leaves behind when it fails cannot
    // answer the follow of another case.
    const first = follow(kit.acme, people.eve);
    // The first follow has taken its place synchronously, so no join can come between the two.
    let second: JoinedPokes | undefined;
    let refusal: string | undefined;
    try {
      second = await follow(kit.acme, people.eve);
    } catch (error) {
      refusal = (error as Error).message;
    }
    try {
      expect(refusal).toMatch(/is followed already and has not joined yet/);
    } finally {
      await second?.stop();
    }
    await (await first).stop();
  });

  test('the wait of a followed stream has no time limit of its own', async () => {
    const polled = Promise.withResolvers<void>();
    // Told when the stream asks for its next frame again, that is after the frame before it has
    // been kept and its wait has been woken: the wait has looked at the first poke by then.
    const tapped = (): AsyncIterable<LiveFrame<unknown>> => {
      const source = kit.invoker.subscribe<unknown, unknown>({
        action: 'live.pokes',
        input: {},
        carrier: testCarrier(kit.acme, people.ada),
        requestId: crypto.randomUUID(),
        signal: new AbortController().signal,
      });
      return {
        [Symbol.asyncIterator]: () => {
          const inner = source[Symbol.asyncIterator]();
          let delivered = false;
          return {
            next: async () => {
              if (delivered) polled.resolve();
              const step = await inner.next();
              delivered = true;
              return step;
            },
            return: async (value) => (await inner.return?.(value)) ?? { done: true, value },
          };
        },
      };
    };
    const stream = await joins.followPokes(followerOf(kit.acme, people.ada), tapped);
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const waiting = stream.until((frames) => named(frames).length >= 2);
      // An hour passes at once, before the first poke: a wait with a limit has run out by then.
      vi.setSystemTime(Date.now() + 3_600_000);
      await card(kit.acme, 'first');
      await polled.promise;
      await card(kit.acme, 'second');
      await waiting;
      expect(named(stream.frames)).toHaveLength(2);
    } finally {
      vi.useRealTimers();
      await stream.stop();
    }
  });

  test('a follow on a runtime that never opened a hub from the watch is refused', async () => {
    const stray = joinWatch();
    const subscribe = vi.fn();
    await expect(stray.followPokes(followerOf(kit.acme, people.ada), subscribe)).rejects.toThrow(
      /no runtime has opened a hub from this watch's live module/,
    );
    expect(subscribe).not.toHaveBeenCalled();
  });

  test('hub close ends the pokes stream without a frame', async () => {
    const ownJoins = joinWatch();
    const own = await startBoard(adapter, ownJoins.live);
    try {
      const stream = await ownJoins.followPokes(followerOf(own.acme, people.ada), () =>
        own.invoker.subscribe<unknown, unknown>({
          action: 'live.pokes',
          input: {},
          carrier: testCarrier(own.acme, people.ada),
          requestId: crypto.randomUUID(),
          signal: new AbortController().signal,
        }),
      );
      await own.write(own.acme, 'board.card.create', { owner: 'ada', title: 'x' });
      await stream.until((frames) => named(frames).length > 0);
      const before = stream.frames.length;
      await own.stop();
      await stream.whenEnded();
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
    const joins = joinWatch();
    const kit = await startLiveApp(adapter, joins.live);
    try {
      const stream = await joins.followPokes(followerOf(kit.acme, adaPrincipal), () =>
        kit.runtime.invoker.subscribe<unknown, unknown>({
          action: 'live.pokes',
          input: {},
          carrier: testCarrier(kit.acme, adaPrincipal),
          requestId: crypto.randomUUID(),
          signal: new AbortController().signal,
        }),
      );
      // A pass is written first: ada reads no passes. The card after it is poked, so a poke of the pass would have come before.
      await kit.call(kit.acme, adaPrincipal, 'passes.issue', { holder: 'ada' });
      await kit.call(kit.acme, writer, 'board.card.create', { owner: 'ada', title: 'visible' });
      await stream.until((frames) => named(frames).length > 0);
      const types = pokes(stream.frames).flatMap((poke) => Object.keys(poke.changed));
      expect(types).toContain('board.card');
      expect(types).not.toContain('passes.pass');
      await stream.stop();
    } finally {
      await kit.stop();
    }
  });

  test('a revoked session ends the pokes stream with unauthenticated', async () => {
    const joins = joinWatch();
    const kit = await startLiveApp(adapter, joins.live);
    try {
      const pass = await kit.call<{ id: string; token: string }>(
        kit.acme,
        adaPrincipal,
        'passes.issue',
        { holder: 'ada' },
      );
      // A pass is a dependency of the session: the stream follows once its reader has joined.
      const followed = await joins.followPokes(
        { tenantId: kit.acme.id, principalId: pass.id },
        () =>
          kit.runtime.invoker.subscribe<unknown, unknown>({
            action: 'live.pokes',
            input: {},
            carrier: kit.bearer(kit.acme, pass.token),
            requestId: crypto.randomUUID(),
            signal: new AbortController().signal,
          }),
      );
      await kit.call(kit.acme, adaPrincipal, 'passes.revoke', { id: pass.id });
      await followed.whenEnded();
      expect(followed.failure()).toMatchObject({ kind: 'unauthenticated' });
    } finally {
      await kit.stop();
    }
  });
});
