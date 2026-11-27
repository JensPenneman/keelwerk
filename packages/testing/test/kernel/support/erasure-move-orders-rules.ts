import type { Order } from './erasure-move-orders-generator.ts';

const state = (facts: Facts, key: string): string =>
  [facts.open.has(key), facts.tombstoned.has(key), facts.sinks.has(key)].map(Number).join('');

/** What an order ended in, read back after its passes: the facts the rules judge. */
export interface Facts {
  readonly order: Order;
  /** How many times the erasure of ada, and that of bea, reached their last step. */
  readonly completed: number;
  readonly completedBea: number;
  /** Whether the crash planned at the step reach happened (a plan that does not happen proves nothing). */
  readonly crashedAtReach: boolean;
  /** How many copies of each record the control ledger holds. */
  readonly copies: number;
  readonly copiesBea: number;
  readonly owner: 'ada' | 'bea' | 'none';
  readonly erased: boolean;
  /** Ada's item keys that were ever seen, and the keys that open; the key of ada's item and of bea's now. */
  readonly seenMine: ReadonlySet<string>;
  readonly taken: readonly string[];
  readonly open: ReadonlySet<string>;
  readonly latest: { readonly mine?: string | undefined; readonly theirs?: string | undefined };
  readonly erasedBeforeMove: boolean;
  /** The item was handed to bea at some time (and may be nobody's now because her own holder was cleared). */
  readonly handed: boolean;
  /** Ada's erasure reached its last step in the first pass (no pass ran again for it), and ada's memo had its owner cleared. */
  readonly finishedFirst: boolean;
  readonly memoCleared: boolean;
  /** The keys with a tombstone in the control ledger, in a sink, and with one that names ada's erasure. */
  readonly tombstoned: ReadonlySet<string>;
  readonly sinks: ReadonlySet<string>;
  readonly ownTombstoned: ReadonlySet<string>;
  /** The key of bea's row that got a tombstone naming another erasure. */
  readonly foreign: ReadonlySet<string>;
  readonly planted: readonly { readonly keyId: string; readonly at: number }[];
  readonly scanned: number;
  readonly swept: ReadonlySet<string>;
  /** The row that holds a value of each subject, when the order has one. */
  readonly memo?: {
    readonly key: string | undefined;
    readonly erased: boolean;
    /** What the `erased` events of the row say, by subject: the fields cleared and whether the row was hers. */
    readonly answers: readonly {
      readonly who: 'ada' | 'bea';
      readonly fields: readonly string[];
      readonly owned: boolean;
    }[];
    readonly receipt: boolean;
  };
  /** Whether the pledge to each one's address, which the step `reach` finds, is erased. */
  readonly pledges?: { readonly ada: boolean; readonly bea: boolean };
  /** Whether the receipt of bea's command through the id of her row is still there. */
  readonly receiptOfBea: boolean;
  /** The deed owned through a holder that nobody owns, when the order has one, and whether its holder was given to ada. */
  readonly deed:
    | { readonly key: string | undefined; readonly erased: boolean; readonly given: boolean }
    | undefined;
}

/** The rules an order broke, and its end with no id and no time in it: the same order under the same seed must end in the same. */
export function judge(facts: Facts): { broken: string[]; digest: string } {
  const { order, open, tombstoned, sinks } = facts;
  const bothErased = order.second !== 'none';
  const broken: string[] = [];
  if (facts.completed === 0 || (bothErased && facts.completedBea === 0))
    broken.push('an erasure did not finish');
  if (order.crashAt === 'reach' && !facts.crashedAtReach)
    broken.push('the crash at reach did not happen');
  if (facts.copies !== 1 || (bothErased && facts.copiesBea !== 1))
    broken.push('the control ledger does not hold an erasure record once');
  for (const key of facts.seenMine) {
    if (!open.has(key) || facts.completed === 0) continue;
    // A row that ada owns at the end is found by the lookup; a row that bea's erasure finds is erased there;
    // the one key that may open is that of a row that bea owns when only ada's erasure runs (the named gap),
    // or a row that stopped being ada's before the erasure read it, so that no tombstone of hers names it.
    if (facts.owner === 'ada') broken.push('a key of the erased subject opens');
    else if (facts.owner === 'bea' && bothErased)
      broken.push('a key of a row of bea opens after her erasure');
    // A row handed to bea and then left to nobody keeps its key only when the pass that finished
    // was the first: it decided the row under the lock while bea owned it (the named gap). A pass
    // that ran again reads the row as nobody's, finds it by its own tombstone, and erases it.
    else if (
      facts.owner === 'none' &&
      !(facts.handed && facts.finishedFirst) &&
      facts.ownTombstoned.has(key)
    )
      broken.push(
        'a key that the erasure recorded a tombstone for opens although the row is nobody’s',
      );
  }
  // The row ada's unit spared (bea's then) and bea's erasure tombstoned, whose owner was cleared before its unit ran: bea's erasure finds it again by its own tombstone.
  if (order.handOver && facts.completedBea > 0) {
    if (!facts.erased) broken.push('a row handed to the second erased subject is not erased');
    if (facts.latest.mine !== undefined && open.has(facts.latest.mine))
      broken.push('the key of a row handed to the second erased subject opens');
  }
  if (!bothErased) {
    if (
      facts.owner === 'bea' &&
      !facts.erasedBeforeMove &&
      facts.latest.mine !== undefined &&
      !open.has(facts.latest.mine)
    )
      broken.push('the key of a row of a living subject is destroyed');
    if (facts.latest.theirs !== undefined && !open.has(facts.latest.theirs))
      broken.push('the key of the living subject own row is destroyed');
    if (!facts.receiptOfBea) broken.push('a receipt of the living subject is purged');
  } else if (facts.receiptOfBea) {
    broken.push('a receipt of an erased subject stays');
  }
  for (const key of facts.taken) {
    // The named gap: a row that another subject owns keeps its key and its tombstone.
    const gap = !bothErased && (facts.owner === 'bea' || facts.handed) && facts.seenMine.has(key);
    if (open.has(key) && !gap && !facts.foreign.has(key) && (tombstoned.has(key) || sinks.has(key)))
      broken.push('a tombstone stands for a key that opens');
    // A key a new secret replaced is destroyed by the write, not by the erasure.
    if (
      !open.has(key) &&
      !(tombstoned.has(key) && sinks.has(key)) &&
      (key === facts.latest.mine || key === facts.latest.theirs)
    )
      broken.push('a destroyed key lacks its tombstone in the ledger or a sink');
  }
  // A planted key whose tombstone the ledger held when the pass that finished began is swept, with its tombstone in the sinks.
  if (facts.completed > 0)
    for (const { keyId, at } of facts.planted)
      if (at <= facts.scanned && (facts.swept.has(keyId) || !sinks.has(keyId)))
        broken.push('a tombstoned key made for no row is not swept with its tombstone');
  const memo = facts.memo;
  if (memo !== undefined) {
    // A row of nobody's, or of bea's while only ada is erased, only holds a value of ada: the value is cleared, and nothing else is touched.
    // Ada's own memo (it also holds a value of ada) is erased when this erasure found it as hers,
    // and then its key is destroyed with a tombstone in the ledger and a sink; a memo whose owner
    // was cleared before the erasure read it only loses her value, and no tombstone names it.
    // Nothing in between: a tombstone for an open key, or an erased row with its key open.
    const mine = order.memo === 'ada';
    const hers = mine ? memo.erased : order.memo === 'bea' && bothErased;
    if (mine && !memo.erased && !facts.memoCleared)
      broken.push('a row of the erased subject that kept its owner stays');
    if (mine && memo.erased && memo.key !== undefined)
      if (!(tombstoned.has(memo.key) && sinks.has(memo.key)))
        broken.push('a destroyed key lacks its tombstone in the ledger or a sink');
    if (!mine && memo.erased !== hers)
      broken.push(
        hers
          ? 'a row of an erased subject stays'
          : 'a row that only holds a value of the erased subject is erased',
      );
    if (memo.key !== undefined && open.has(memo.key) === hers)
      broken.push(
        hers
          ? 'the key of an erased row opens'
          : 'the key of a row that only holds a value is destroyed',
      );
    if (memo.key !== undefined && !hers && (tombstoned.has(memo.key) || sinks.has(memo.key)))
      broken.push('a tombstone stands for the key of a row that only holds a value');
    if (memo.receipt === hers)
      broken.push(
        hers
          ? 'a receipt of an erased row stays'
          : 'a receipt through the id of a row that is not erased is purged',
      );
    const adas = memo.answers.find(({ who }) => who === 'ada');
    if (
      (mine || !hers) &&
      facts.completed > 0 &&
      (adas?.owned !== (mine && memo.erased) || !adas.fields.includes('about'))
    )
      broken.push('the value of the erased subject stays in the row that holds it');
  }
  const { deed } = facts;
  if (deed !== undefined && facts.completed > 0) {
    // A row that is ada's at the end (her holder was given to her during the erasure) is erased, key destroyed, tombstone in the ledger and a sink;
    // one that was never hers only loses her value: no erasure, key open, no tombstone.
    if (deed.erased !== deed.given)
      broken.push(
        deed.given
          ? 'a row that is the erased subject’s at the end is not erased'
          : 'a row that only holds a value of the erased subject is erased',
      );
    if (
      deed.key !== undefined &&
      (open.has(deed.key) === deed.given ||
        (!deed.given && (tombstoned.has(deed.key) || sinks.has(deed.key))))
    )
      broken.push('the key of a deed does not follow whose row it is');
    if (deed.key !== undefined && deed.given && !(tombstoned.has(deed.key) && sinks.has(deed.key)))
      broken.push('a destroyed key lacks its tombstone in the ledger or a sink');
  }
  // The step reach: the pledge to ada's address is erased with her, the one to bea's address only with bea.
  const { pledges } = facts;
  if (pledges !== undefined) {
    if (facts.completed > 0 && !pledges.ada)
      broken.push('a pledge to the address of the erased subject stays');
    if (pledges.bea !== (bothErased && facts.completedBea > 0))
      broken.push(
        pledges.bea
          ? 'a pledge to the address of a living subject is erased'
          : 'a pledge to the address of an erased subject stays',
      );
  }
  const unique = [...new Set(broken)];
  const digest = JSON.stringify({
    completed: facts.completed,
    completedBea: facts.completedBea,
    copies: facts.copies,
    owner: facts.owner,
    erased: facts.erased,
    keys: facts.taken.map(
      (key) => `${facts.seenMine.has(key) ? 'mine' : 'theirs'}${state(facts, key)}`,
    ),
    planted: facts.planted.map(
      ({ keyId }) => `${Number(facts.swept.has(keyId))}${Number(sinks.has(keyId))}`,
    ),
    memo:
      memo === undefined
        ? null
        : `${Number(memo.erased)}${Number(memo.receipt)}${JSON.stringify(memo.answers)}`,
    receiptOfBea: facts.receiptOfBea,
    deed: deed === undefined ? null : `${Number(deed.given)}${Number(deed.erased)}`,
    pledges: pledges === undefined ? null : [pledges.ada, pledges.bea].map(Number).join(''),
    broken: unique,
  });
  return { broken: unique, digest };
}
