import type { ErasureStep } from '@keelwerk/core';
import { fixedOrders } from './erasure-move-orders-fixed.ts';

const steps: readonly ErasureStep[] = [
  'ledger',
  'shred',
  'tombstones',
  'streams',
  'principals',
  'flags',
  'receipt',
  'completed',
];

/** A small seeded generator (mulberry32): the same seed gives the same orders on every machine. */
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function orderOf(next: () => number, depth: 1 | 2 | 3): Order {
  // The row that holds a value of each of two subjects: owned by nobody from the start, by bea, by ada, or absent.
  const memoRoll = next();
  const memo =
    memoRoll < 0.25 ? 'ownerless' : memoRoll < 0.4 ? 'bea' : memoRoll < 0.65 ? 'ada' : 'none';
  // The second subject's own erasure, requested before or after the first one's, in a third of the orders.
  const secondRoll = next();
  const second = secondRoll < 0.15 ? 'before' : secondRoll < 0.33 ? 'after' : 'none';
  // The sink is down once, when it takes the n-th batch that carries a key tombstone, in two of five orders.
  const down = next() < 0.4 ? Math.floor(next() * 6) : undefined;
  const pool: Action[] = ['self', 'secret', 'clear', 'clearTheirs', 'foreign', 'clearMemo'];
  if (depth > 1) pool.push('hop1');
  if (depth > 2) pool.push('hop2');
  const some = (most: number, from: readonly Action[] = pool): Action[] =>
    Array.from(
      { length: Math.floor(next() * (most + 1)) },
      () => from[Math.floor(next() * from.length)] as Action,
    );
  // A quarter of the orders is the moment itself: nothing else happens but what runs as the sink takes the row's tombstone.
  if (next() < 0.25) {
    const atTombstone = some(2);
    if (atTombstone.length === 0)
      atTombstone.push(pool[Math.floor(next() * pool.length)] as Action);
    return {
      depth,
      memo,
      second,
      down,
      handOver: false,
      deed: false,
      pre: [],
      during: {},
      atSink: {},
      atTombstone,
      crashAt: undefined,
      post: [],
    };
  }
  const during: Partial<Record<ErasureStep, readonly Action[]>> = {};
  for (const step of steps) if (next() < 0.4) during[step] = some(2, [...pool, 'plant']);
  // Right after the pass has put its record to the sinks, the ledger holds a tombstone of another erasure after it, for the key of a row of the living subject.
  if (next() < 0.2) during.ledger = [...(during.ledger ?? []), 'foreign'];
  const atSink: Record<number, readonly Action[]> = {};
  for (let batch = 0; batch < 8; batch += 1) if (next() < 0.3) atSink[batch] = some(2);
  const crashAt = next() < 0.4 ? steps[Math.floor(next() * (steps.length - 1))] : undefined;
  return {
    depth,
    memo,
    second,
    down,
    handOver: false,
    deed: false,
    pre: some(2),
    during,
    atSink,
    atTombstone: next() < 0.7 ? some(2) : [],
    crashAt,
    post: some(2),
  };
}

/**
 * What can happen to the owned row, to a row its subject path runs through, or to its secret; the
 * owner at the root of the path can be cleared, and so can the living subject's (`clearTheirs`); a
 * key made for something that is no row (a job, a command's decision, an effect, a receipt, an
 * entity the registry lacks) can get a tombstone in the control ledger, as another erasure or an
 * earlier pass of this one leaves it (`plant`); and so can the key of the living subject's own row
 * (`foreign`: a tombstone that names another erasure's command). The last two only between two
 * steps of the pass, where the moment is known. `clearMemo` empties the owner of the row that
 * holds a value of each subject, when the order has one that ada owns.
 */
export type Action =
  | 'self'
  | 'hop1'
  | 'hop2'
  | 'secret'
  | 'clear'
  | 'clearTheirs'
  | 'clearMemo'
  | 'release'
  | 'handHolder'
  | 'plant'
  | 'foreign';
export interface Order {
  readonly depth: 1 | 2 | 3;
  /** A row that holds a value of each subject: nobody's from the start, bea's, ada's, or none. */
  readonly memo: 'none' | 'ownerless' | 'bea' | 'ada';
  /** The sink refuses once, as it takes the batch of key tombstones with this number (counted from the request), or never. */
  readonly down: number | undefined;
  /**
   * The row of ada is handed to bea as the sink takes ada's tombstone for its key (the named gap:
   * ada's unit spares it), the sink then refuses bea's tombstone for the same key, and the row's
   * owner is cleared (`release`, in `post`): bea's erasure runs again and must find the row by its
   * own tombstone. Only with a second erasure after the first, at depth 1.
   */
  readonly handOver: boolean;
  /** Whether the second subject is erased too (a real erasure of her own), and whether her record comes first. */
  readonly second: 'none' | 'before' | 'after';
  /**
   * The order has a deed owned through a holder that nobody owns, holding a value of ada, and the
   * holder is given to ada right after the erasure answered the deed as a mere holder (`handHolder`
   * in `during.streams`, or not at all): the deed is hers at the end, and a row that is hers at the
   * end is erased.
   */
  readonly deed: boolean;
  readonly pre: readonly Action[];
  readonly during: Readonly<Partial<Record<ErasureStep, readonly Action[]>>>;
  /** Actions that run as the sink takes its n-th batch of records after the request. */
  readonly atSink: Readonly<Record<number, readonly Action[]>>;
  /** Actions that run as the sink takes a tombstone: the erasure has not reached the unit that destroys the key. */
  readonly atTombstone: readonly Action[];
  readonly crashAt: ErasureStep | undefined;
  readonly post: readonly Action[];
}

export const plantedKinds = [
  'core.job',
  'core.decision',
  'core.effect',
  'core.commandReceipt',
  'gone.thing',
];
export const orders = [
  ...([1, 2, 3] as const).flatMap((depth) => {
    const next = random(20261126 + depth);
    // A deed in a fifth of the orders, from a draw of its own so that the other orders stay what they were.
    const side = random(20271127 + depth);
    return Array.from({ length: 100 }, (): Order => {
      const order = orderOf(next, depth);
      if (side() >= 0.2) return order;
      const during = {
        ...order.during,
        streams: [...(order.during.streams ?? []), 'handHolder' as const],
      };
      return { ...order, deed: true, during: side() < 0.8 ? during : order.during };
    });
  }),
  ...fixedOrders,
];
