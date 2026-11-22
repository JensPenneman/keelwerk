import { defineApp } from '@keelwerk/core';
import { startTestRuntime, testCarrier, testPrincipal } from '@keelwerk/testing';
import { afterAll, describe, expect, test, vi } from 'vitest';
import { followerOf, joinWatch } from '../support/follow-pokes.ts';
import { type pokes, pokesNaming } from '../support/poke-frames.ts';
import { ownedEntries } from './support/ledger-module.ts';

vi.setConfig({ testTimeout: 60_000 });

const writer = testPrincipal('w', { claims: { seed: true } });
const ada = testPrincipal('ada');
const bob = testPrincipal('bob');

const joins = joinWatch();

describe.each(['memory', 'pglite'] as const)(
  'live.pokes of an entity whose rows belong to their owners on %s',
  (adapter) => {
    const started = startTestRuntime(
      defineApp({ id: 'ledgerapp', modules: [joins.live, ownedEntries] }),
      {
        adapter,
        tenants: ['acme'],
      },
    );
    afterAll(async () => (await started).stop());

    async function setUp() {
      const runtime = await started;
      const { acme } = runtime.tenants;
      const call = async <T = { id: string }>(who: typeof ada, action: string, input: unknown) => {
        const outcome = await runtime.invoker.invoke<unknown, T>({
          action,
          input,
          carrier: testCarrier(acme, who),
          requestId: crypto.randomUUID(),
          signal: new AbortController().signal,
          commandId: crypto.randomUUID(),
        });
        if (!outcome.ok) throw outcome.error;
        return outcome.value;
      };
      /** Follows the pokes of a principal and answers once the reader has joined: a write after that is poked. */
      const follow = (who: typeof ada) =>
        joins.followPokes(followerOf(acme, who), () =>
          runtime.invoker.subscribe<unknown, unknown>({
            action: 'live.pokes',
            input: {},
            carrier: testCarrier(acme, who),
            requestId: crypto.randomUUID(),
            signal: new AbortController().signal,
          }),
        );
      const entry = (owner: string, amount = 1) =>
        call(writer, 'ledger.entry.create', { owner, amount });
      return { call, follow, entry };
    }

    const named = (frames: Parameters<typeof pokes>[0]) => pokesNaming(frames, 'ledger.entry');

    test('a change to the row of another is not poked, and one to its own row is', async () => {
      const { follow, entry } = await setUp();
      const mine = await follow(ada);
      const hers = await follow(bob);
      try {
        // Bob's entry is poked to bob, and the reader gave the same batch to ada at that moment.
        await entry('bob', 5);
        await hers.until((frames) => named(frames).length > 0);
        expect(named(mine.frames)).toHaveLength(0);
        await entry('ada', 7);
        await mine.until((frames) => named(frames).length > 0);
        expect(named(mine.frames)).toHaveLength(1);
      } finally {
        await mine.stop();
        await hers.stop();
      }
    });

    test('a row that leaves the plan of its owner is still poked to that owner', async () => {
      const { follow, entry, call } = await setUp();
      const mine = await follow(ada);
      const hers = await follow(bob);
      try {
        const kept = await entry('ada', 2);
        await mine.until((frames) => named(frames).length > 0);
        const afterCreate = named(mine.frames).length;
        // The row moves to bob: ada can no longer read it, and her client holds a stale copy.
        await call(writer, 'ledger.entry.update', { id: kept.id, patch: { owner: 'bob' } });
        await mine.until((frames) => named(frames).length > afterCreate);
        const afterMove = named(mine.frames).length;
        // A further change to it is a change to the row of another: bob is poked, ada is not.
        const bobBase = named(hers.frames).length;
        await call(writer, 'ledger.entry.update', { id: kept.id, patch: { amount: 9 } });
        await hers.until((frames) => named(frames).length > bobBase);
        expect(named(mine.frames)).toHaveLength(afterMove);
      } finally {
        await mine.stop();
        await hers.stop();
      }
    });

    test('an entity declared without a watch is never named', async () => {
      const { follow, entry, call } = await setUp();
      const mine = await follow(ada);
      try {
        await call(writer, 'ledger.note.create', { owner: 'ada', text: 'hello' });
        await entry('ada', 3);
        await mine.until((frames) => named(frames).length > 0);
        expect(pokesNaming(mine.frames, 'ledger.note')).toEqual([]);
      } finally {
        await mine.stop();
      }
    });
  },
);
