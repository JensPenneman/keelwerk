import type { Order } from './erasure-move-orders-generator.ts';

const handOver: Order = {
  depth: 1,
  memo: 'none',
  second: 'after',
  down: undefined,
  handOver: true,
  deed: false,
  pre: [],
  during: {},
  atSink: {},
  atTombstone: [],
  crashAt: undefined,
  post: ['release'],
};

/**
 * The orders that the seeded draw only meets by chance, each run in every search: the row of ada
 * handed to bea, whose own erasure then finds the key of a row that already holds ada's tombstone
 * (the sink is down once for bea's, and the owner is cleared); and ada's memo (it also holds a
 * value of ada) whose owner is cleared after the pass in which the sink refused a batch of key
 * tombstones, one order for each of the first six batches.
 */
export const fixedOrders: readonly Order[] = [
  handOver,
  // A deed whose holder is given to ada right after the deed was answered as a mere holder, with the sink down once at each of the first four batches of key tombstones.
  ...Array.from(
    { length: 4 },
    (_, down): Order => ({
      ...handOver,
      deed: true,
      second: 'none',
      down,
      handOver: false,
      during: { streams: ['handHolder'] },
      post: [],
    }),
  ),
  ...Array.from(
    { length: 6 },
    (_, down): Order => ({
      ...handOver,
      memo: 'ada',
      second: 'none',
      down,
      handOver: false,
      post: ['clearMemo'],
    }),
  ),
];
