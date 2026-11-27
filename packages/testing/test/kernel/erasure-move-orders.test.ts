import type { ErasureRecord, ErasureStep } from '@keelwerk/core';
import { afterAll, beforeAll, expect, test } from 'vitest';
import {
  type Action,
  type Order,
  orders,
  plantedKinds,
} from './support/erasure-move-orders-generator.ts';
import { readLedger } from './support/erasure-move-orders-ledger.ts';
import { judge } from './support/erasure-move-orders-rules.ts';
import { type Ending, runTwice } from './support/erasure-move-orders-twice.ts';
import { bootWorld } from './support/erasure-move-orders-world.ts';

let world: Awaited<ReturnType<typeof bootWorld>>;
let cursor = 0n;
let runs = 0;
beforeAll(async () => {
  world = await bootWorld();
});
afterAll(async () => {
  await world.runtime.stop();
});

async function run(order: Order): Promise<Ending> {
  const { live, worker, runtime, operator, records } = world;
  const at = (rows: readonly string[], index: number) => rows[index] as string;
  // An address of its own for each order: the world is shared, and a pledge must name one subject's address only.
  runs += 1;
  const [adaAddress, beaAddress] = [`ada${runs}@example.test`, `bea${runs}@example.test`];
  const [ada, bea] = [
    await world.make('member', adaAddress),
    await world.make('member', beaAddress),
  ];
  // A pledge to each address, in the orders that crash at the step reach and in a fifth of the others: each is an erasure of its own, and the search stays short.
  const pledges =
    order.crashAt === 'reach' || order.memo === 'bea'
      ? ([await world.makePledge(adaAddress), await world.makePledge(beaAddress)] as const)
      : undefined;
  const names: Record<string, 'ada' | 'bea'> = {
    [ada.toLowerCase()]: 'ada',
    [bea.toLowerCase()]: 'bea',
  };
  // The rows of both subjects, from the root of the path down to the owned row.
  const chainOf = (owner: string) => world.chainOf(order.depth, owner);
  const [mine, theirs] = [await chainOf(ada), await chainOf(bea)];
  const kinds = [[], ['parcel'], ['holder2', 'item2'], ['holder3', 'box3', 'item3']][
    order.depth
  ] as string[];
  const itemKind = at(kinds, order.depth - 1);
  const item = at(mine, order.depth - 1);
  const theirItem = at(theirs, order.depth - 1);
  // The row that holds a value of each subject, and bea acting through its id and through the id of her own row.
  const memo =
    order.memo === 'none'
      ? undefined
      : await world.makeMemo(
          ada,
          bea,
          order.memo === 'bea' ? bea : order.memo === 'ada' ? ada : undefined,
        );
  const memoCommand = memo === undefined ? undefined : await world.act(bea, memo);
  // A deed owned through a holder that nobody owns, holding a value of ada: handed to her holder during her erasure by `handHolder`.
  const deed = order.deed ? await world.makeDeed(ada) : undefined;
  const deedKey = deed === undefined ? undefined : await world.keyOf('deed', deed.id);
  let deedGiven = false;
  // Read now: an erased row's sealed column no longer names its key.
  const memoKey = memo === undefined ? undefined : await world.keyOf('memo', memo);
  const theirCommand = await world.act(bea, theirItem);
  /** Each planted key with the number of the action it was planted at, and the number the last pass began its scan at. */
  const planted: { readonly keyId: string; readonly at: number }[] = [];
  const foreign = new Set<string>();
  let ticks = 0;
  let scanned = -1;
  let requested = false;
  const seen = new Set<string>();
  const seenMine = new Set<string>();
  const latest: { mine?: string | undefined; theirs?: string | undefined } = {};
  const note = async () => {
    for (const [id, owner] of [
      [item, 'mine'],
      [theirItem, 'theirs'],
    ] as const) {
      const key = await world.keyOf(itemKind, id);
      if (key !== undefined) seen.add(key);
      if (key !== undefined && owner === 'mine') seenMine.add(key);
      latest[owner] = key ?? latest[owner];
    }
  };
  await note();
  let counter = 0;
  /** A row that was erased as the erased subject's may be moved afterwards: its key is gone, rightly. */
  let erasedBeforeMove = false;
  let handed = false;
  /** Ada's memo had its owner cleared. */
  let memoCleared = false;
  /** Hands the row `index` of the path (the root is 0) to the other subject's row one level up. */
  const move = (index: number) =>
    world.change(at(kinds, index), at(mine, index), {
      link: index === 0 ? bea : at(theirs, index - 1),
    });
  /** Whose row the item is now: the subject at the root of its path, or none. */
  const ownerNow = async (): Promise<unknown> => {
    const itemRow = await world.rowOf(itemKind, item);
    if (order.depth === 1) return itemRow?.owner;
    if (order.depth === 2) return (await world.rowOf('holder2', String(itemRow?.holderId)))?.owner;
    const box = await world.rowOf('box3', String(itemRow?.boxId));
    return (await world.rowOf('holder3', String(box?.holderId)))?.owner;
  };
  const mineOwn = (subject: string) => subject.toLowerCase() === ada.toLowerCase();
  const second = order.second !== 'none';
  const apply = async (action: Action) => {
    ticks += 1;
    if (action === 'plant' || action === 'foreign') {
      // Tombstones that the control ledger holds after the erasure's record, as another erasure or an earlier pass leaves them.
      if (!requested || (action === 'foreign' && second)) return;
      if (action === 'foreign') {
        const key = await world.keyOf(itemKind, theirItem);
        if (key === undefined) return;
        foreign.add(key);
        await world.tombstone(key, crypto.randomUUID());
        // The other erasure found the row bea's and left it; her holder is cleared after it.
        await world.change(at(kinds, 0), at(theirs, 0), { clear: true });
        return;
      }
      const entity = plantedKinds[planted.length % plantedKinds.length] as string;
      const sealed = await world.inUnit((unit) =>
        unit.keys.sealValue({ entity, id: `planted ${ticks}`, field: 'x' }, new Uint8Array([1])),
      );
      await world.tombstone(sealed.keyId);
      planted.push({ keyId: sealed.keyId, at: ticks });
      return;
    }
    if (action === 'handHolder') {
      // Once, right after the erasure answered the deed as a mere holder: her keys are not destroyed yet.
      if (requested && deed !== undefined && !deedGiven)
        deedGiven = await world.handHolder(deed, ada);
      return;
    }
    if (action === 'release' || action === 'clearMemo') {
      // The owner of the handed row, or of ada's memo, is emptied.
      if (action === 'clearMemo' && (memo === undefined || order.memo !== 'ada')) return;
      const [kind, id] = action === 'release' ? [at(kinds, 0), at(mine, 0)] : ['memo', memo];
      await world.change(kind as string, id as string, { clear: true });
      memoCleared ||= action === 'clearMemo';
      return;
    }
    if (action === 'clearTheirs') {
      // Bea's root cleared: nothing names her row, and it stays as it is (not while she is erased too, where it is her erasure's to find).
      if (!second) await world.change(at(kinds, 0), at(theirs, 0), { clear: true });
    } else if (action === 'clear') {
      // Once the erasure runs, a row that another subject owns is not cleared: it could be cleared after the unit that left it alone, which is the named gap and no more.
      if (requested && (await ownerNow()) === bea) return;
      await world.change(at(kinds, 0), at(mine, 0), { clear: true });
    } else if (action === 'secret') {
      counter += 1;
      await world.change(itemKind, item, { secret: `new secret ${counter}` });
    } else {
      // A row handed to a subject whose own erasure runs is the erased subject's to receive (14.7.4), not a move to a living one.
      if (requested && second) return;
      erasedBeforeMove ||= (await world.rowOf(itemKind, item))?.kwErasedAt != null;
      handed = true;
      await move(action === 'self' ? order.depth - 1 : action === 'hop1' ? order.depth - 2 : 0);
    }
    await note();
  };
  const all = async (actions: readonly Action[] = []) => {
    for (const action of actions) await apply(action);
  };
  const before = records.length;
  const erase = (subject: string) =>
    operator.invoke(
      'core.eraseSubject',
      { subjectId: subject as never, reason: 'subjectRequest' } as never,
      { prefer: 'async' },
    );
  await all(order.pre);
  if (order.second === 'before') await erase(bea);
  await erase(ada);
  if (order.second === 'after') await erase(bea);
  await runtime.drainJobs();
  requested = true;
  live.batches = 0;
  let tombstonesTaken = 0;
  let refused = false;
  let keyedBatches = 0;
  live.refuse = (batch) => {
    if (order.handOver) {
      // The second batch that carries a tombstone of the row's key is bea's: the sink is down for it once.
      const keyed = batch.some((one) => one.type === 'keyTombstone' && seenMine.has(one.keyId));
      keyedBatches += keyed ? 1 : 0;
      return keyed && keyedBatches === 2;
    }
    if (order.down === undefined || refused || !batch.some((one) => one.type === 'keyTombstone'))
      return false;
    if (tombstonesTaken < order.down) {
      tombstonesTaken += 1;
      return false;
    }
    refused = true;
    return true;
  };
  let inside = false;
  let tombstoneBatches = 0;
  live.atSink = async (batch, taken) => {
    if (inside) return;
    inside = true;
    await all(order.atSink[batch]);
    // At the first two batches that carry a tombstone of the row's key only: a new secret there makes a new key and so another batch.
    const keyed = taken.some((one) => one.type === 'keyTombstone' && seenMine.has(one.keyId));
    if (keyed) tombstoneBatches += 1;
    if (keyed && tombstoneBatches <= 2) await all(order.atTombstone);
    if (order.handOver && keyed && tombstoneBatches === 1) {
      handed = true;
      await move(0);
      await note();
    }
    inside = false;
  };
  let completed = 0;
  let completedBea = 0;
  let crashedAtReach = false;
  /** The erasures of this order that reached their last step: the order's own records only. */
  const count = (step: ErasureStep, own: ErasureRecord) => {
    if (step !== 'completed') return;
    if (mineOwn(own.subjectId)) completed += 1;
    else if (own.subjectId.toLowerCase() === bea.toLowerCase()) completedBea += 1;
  };
  live.during = async (step, own) => {
    count(step, own);
    await all(order.during[step]);
    // A pass reads the tombstones of the ledger right after its first step: what is planted by now is its to sweep.
    if (step === 'ledger') scanned = ticks;
    if (step === order.crashAt) {
      crashedAtReach ||= step === 'reach';
      throw new Error('crash between steps');
    }
  };
  await worker.pass();
  const finishedFirst = completed > 0;
  await all(order.post);
  live.during = async (step, own) => count(step, own);
  live.atSink = async () => {};
  for (let again = 0; again < 3 && (completed === 0 || (second && completedBea === 0)); again += 1)
    await worker.pass();
  await runtime.drainJobs();
  // The erasure of a pledge is requested by the person's and runs after it: its request becomes a record, and the record runs.
  for (let round = 0; pledges !== undefined && round < 3; round += 1) {
    await worker.pass();
    await runtime.drainJobs();
  }

  const owner = await ownerNow();
  const taken = [...seen];
  const keys = [...taken, ...[memoKey, deedKey].filter((key) => key !== undefined)];
  const open = await world.opens(keys);
  const ledgered = await readLedger(runtime, cursor, { ada, bea });
  cursor = ledgered.cursor;
  const { tombstoned, ownTombstoned, copies, copiesBea } = ledgered;
  const sinks = new Set(
    records
      .slice(before)
      .flatMap((record) => (record.type === 'keyTombstone' ? [record.keyId] : [])),
  );
  const swept = await world.opens(planted.map(({ keyId }) => keyId));
  const { broken, digest } = judge({
    order,
    completed,
    completedBea,
    crashedAtReach,
    copies,
    copiesBea,
    owner: owner === ada ? 'ada' : owner === bea ? 'bea' : 'none',
    erased: (await world.rowOf(itemKind, item))?.kwErasedAt != null,
    seenMine,
    taken,
    open,
    latest,
    erasedBeforeMove,
    handed,
    finishedFirst,
    memoCleared,
    tombstoned,
    sinks,
    ownTombstoned,
    foreign,
    planted,
    scanned,
    swept,
    ...(memo === undefined || memoCommand === undefined
      ? {}
      : {
          memo: {
            key: memoKey,
            erased: (await world.rowOf('memo', memo))?.kwErasedAt != null,
            answers: await world.answersOf('memo', memo, names),
            receipt: await world.receiptOf(memoCommand),
          },
        }),
    receiptOfBea: await world.receiptOf(theirCommand),
    deed:
      deed === undefined
        ? undefined
        : {
            key: deedKey,
            erased: (await world.rowOf('deed', deed.id))?.kwErasedAt != null,
            given: deedGiven,
          },
    ...(pledges === undefined
      ? {}
      : {
          pledges: {
            ada: (await world.rowOf('pledge', pledges[0]))?.kwErasedAt != null,
            bea: (await world.rowOf('pledge', pledges[1]))?.kwErasedAt != null,
          },
        }),
  });
  return { broken, digest };
}

test('after any order of moves, secrets, steps, crashes, reruns and a second erasure, no key of a living subject is destroyed, nothing of a living subject is erased or purged, nothing of the erased subject opens, and the same order always ends the same', {
  timeout: 360_000,
}, async () => {
  const { failures, differing } = await runTwice(orders, run);
  expect(failures.slice(0, 3)).toEqual([]);
  expect(differing.slice(0, 3)).toEqual([]);
});
