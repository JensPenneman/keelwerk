import type { Order } from './erasure-move-orders-generator.ts';

/** What an order ended in: the rules it broke, and its end with no id and no time in it. */
export interface Ending {
  readonly broken: readonly string[];
  readonly digest: string;
}

/**
 * Runs every order twice, the second time on new rows of the same runtime: the rules each first run
 * broke, and the orders that, under the same seed, ended differently the second time.
 */
export async function runTwice(orders: readonly Order[], run: (order: Order) => Promise<Ending>) {
  const failures: { readonly order: Order; readonly broken: readonly string[] }[] = [];
  const differing: { readonly order: Order; readonly first: string; readonly second: string }[] =
    [];
  for (const order of orders) {
    // Three findings are all the report shows: a broken search stops there.
    if (failures.length >= 3 || differing.length >= 3) break;
    const first = await run(order);
    if (first.broken.length > 0) failures.push({ order, broken: first.broken });
    const second = await run(order);
    if (second.digest !== first.digest) {
      differing.push({ order, first: first.digest, second: second.digest });
    }
  }
  return { failures, differing };
}
