import type { ScopeTarget } from '../invoker/scope-target.ts';
import type { Clock } from '../kernel/clock.ts';
import { createHeldTokens, type Held } from './held-tokens.ts';
import type { ProcessAllowance, RateBucket } from './process-allowance.ts';

const defaultHoldMs = 1000;
const defaultMost = 10_000;
/** The most tokens one draw takes beyond the one it spends. */
const mostDraw = 10;

/** The scope the entries of a target are kept under: its namespace and its scope. */
function scopeNameOf(target: ScopeTarget): string {
  const { scope } = target;
  switch (scope.level) {
    case 'tenant':
      return `${target.namespace.id}\u0000tenant\u0000${scope.backendId}\u0000${scope.tenantId}`;
    case 'backend':
      return `${target.namespace.id}\u0000backend\u0000${scope.backendId}`;
    case 'deployment':
      return `${target.namespace.id}\u0000deployment`;
  }
}

function usable(limit: RateBucket['limit']): boolean {
  return (
    Number.isFinite(limit.capacity) &&
    Number.isFinite(limit.refillPerSecond) &&
    limit.capacity >= 1 &&
    limit.refillPerSecond > 0
  );
}

function drawOf(limit: RateBucket['limit']): number {
  return Math.max(1, Math.min(mostDraw, Math.floor(limit.capacity / 10)));
}

/** A take that refused after its check allowed it: only a clock that stepped back does that. */
class StoreRefusal extends Error {
  readonly wait: number;
  constructor(wait: number) {
    super('A bucket refused a take that its check had allowed.');
    this.name = 'StoreRefusal';
    this.wait = wait;
  }
}

/**
 * A process's allowance of the shared rate buckets (S-143, decision 156): a request that finds the
 * bucket's tokens held takes one without a store round trip; a request that does not draws up to
 * a tenth of the bucket's capacity (at most 10 tokens) in the same unit that takes its own, and
 * while that draw is in flight the requests that miss take one token each, so a process never
 * holds more than one draw per bucket. Held tokens lapse `holdMs` after the draw (a clock that
 * steps back lapses them at once) and are never returned to the store. The buckets of a request
 * are taken in the order given and the first refusal stops the rest: every bucket but the last
 * that needs the store is locked and read before any is taken, so a refused request takes no token
 * of the shared buckets and the tokens it took from the process's own held tokens go back. Across
 * processes at most `n - 1` tokens per process and bucket are lost or spent early, refusals
 * included.
 */
export function createProcessAllowance(options: {
  readonly clock: Clock;
  /** How long taken tokens are held, and how long a draw counts as recent; default 1,000. */
  readonly holdMs?: number;
  /**
   * The most buckets held; default 10,000. Above it the least recently used bucket of the scope
   * that holds the most is dropped, and with it at most 9 tokens that lapse unspent.
   */
  readonly most?: number;
}): ProcessAllowance {
  const holdMs = options.holdMs ?? defaultHoldMs;
  const most = options.most ?? defaultMost;
  const held = createHeldTokens(most);
  const drawing = new Set<string>();
  /** Fresh from the take until `holdMs` after it; an entry dated after the clock's reading has lapsed. */
  const freshOf = (entry: Held | undefined, now: Temporal.Instant): entry is Held => {
    if (entry === undefined) return false;
    const age = now.since(entry.takenAt).total('milliseconds');
    return age >= 0 && age < holdMs;
  };
  /** Takes a held token when the bucket holds one that has not lapsed. */
  const takeHeld = (scope: string, name: string): boolean => {
    const entry = held.get(scope, name);
    if (!freshOf(entry, options.clock.now()) || entry.tokens < 1) return false;
    entry.tokens -= 1;
    held.remember(scope, name, entry);
    return true;
  };
  /** Puts a held token back; a bucket whose tokens lapsed or were dropped gets nothing. */
  const putBack = (scope: string, name: string): void => {
    const entry = held.get(scope, name);
    if (freshOf(entry, options.clock.now())) entry.tokens += 1;
  };
  /**
   * Adds the tokens a draw left to what is held now: requests that overlap each add their own,
   * and the entry's time never moves back to an earlier request's start. An entry that lapsed
   * while the unit ran counts as 0 and the new tokens are dated from the start of their request,
   * never later than the clock's reading now.
   */
  const settle = (scope: string, name: string, tokens: number, started: Temporal.Instant): void => {
    const now = options.clock.now();
    const current = held.get(scope, name);
    const live = freshOf(current, now);
    const dated =
      live && Temporal.Instant.compare(current.takenAt, started) > 0 ? current.takenAt : started;
    const takenAt = Temporal.Instant.compare(dated, now) > 0 ? now : dated;
    held.remember(scope, name, { tokens: (live ? current.tokens : 0) + tokens, takenAt });
  };

  return {
    async take(target, buckets, dry) {
      const started = options.clock.now();
      if (buckets.some((bucket) => !usable(bucket.limit))) return 1;
      const scope = scopeNameOf(target);
      const names = buckets.map((bucket) => bucket.key);
      const drawKey = (name: string): string => `${scope}\u0000${name}`;
      if (dry) {
        const pending = buckets.filter((_bucket, at) => {
          const entry = held.get(scope, names[at] ?? '');
          return !(freshOf(entry, started) && entry.tokens >= 1);
        });
        if (pending.length === 0) return undefined;
        let wait: number | undefined;
        await target.handle.adapter.unit(
          target.namespace,
          target.scope,
          async (unit) => {
            for (const bucket of pending) {
              const read = await unit.buckets.check(bucket.key, 1, bucket.limit);
              if (!read.ok) {
                wait = read.retryAfter ?? 1;
                return;
              }
            }
          },
          { readOnly: true },
        );
        return wait;
      }
      // Held tokens come first, in order, up to the first bucket that needs the store.
      const heldNames: string[] = [];
      let next = 0;
      while (next < buckets.length) {
        const name = names[next] ?? '';
        if (!takeHeld(scope, name)) break;
        heldNames.push(name);
        next += 1;
      }
      if (next === buckets.length) return undefined;
      // This request draws up to n tokens of a bucket that was fresh and empty when it began, unless
      // another request of this process is drawing already: one draw per bucket is in flight.
      const marked: string[] = [];
      const costs = buckets.map((bucket, at) => {
        const name = names[at] ?? '';
        const entry = held.get(scope, name);
        if (
          at < next ||
          !freshOf(entry, started) ||
          entry.tokens >= 1 ||
          drawing.has(drawKey(name))
        )
          return 1;
        drawing.add(drawKey(name));
        marked.push(name);
        return drawOf(bucket.limit);
      });
      const drawn: { name: string; cost: number }[] = [];
      let wait: number | undefined;
      try {
        await target.handle.adapter.unit(target.namespace, target.scope, async (unit) => {
          // Held tokens first and without an await; the buckets that need the store follow in order.
          const pending: number[] = [];
          for (let at = next; at < buckets.length; at += 1) {
            const name = names[at] ?? '';
            if (takeHeld(scope, name)) heldNames.push(name);
            else pending.push(at);
          }
          // Every pending bucket but the last is locked (a take of 0 creates, locks and refills its
          // row) and read; the last is taken at once. The first refusal stops the request before any
          // of the locked buckets is taken.
          const locked: { bucket: RateBucket; name: string; cost: number }[] = [];
          const taken: { name: string; cost: number }[] = [];
          for (const [position, at] of pending.entries()) {
            const bucket = buckets[at];
            const name = names[at];
            if (bucket === undefined || name === undefined) continue;
            let cost = costs[at] ?? 1;
            if (position < pending.length - 1) {
              await unit.buckets.take(bucket.key, 0, bucket.limit);
              let read = await unit.buckets.check(bucket.key, cost, bucket.limit);
              if (!read.ok && cost > 1) {
                cost = 1;
                read = await unit.buckets.check(bucket.key, cost, bucket.limit);
              }
              if (!read.ok) {
                wait = read.retryAfter ?? 1;
                return;
              }
              locked.push({ bucket, name, cost });
              continue;
            }
            let result = await unit.buckets.take(bucket.key, cost, bucket.limit);
            if (!result.ok && cost > 1) {
              cost = 1;
              result = await unit.buckets.take(bucket.key, cost, bucket.limit);
            }
            if (!result.ok) {
              wait = result.retryAfter ?? 1;
              return;
            }
            taken.push({ name, cost });
          }
          for (const { bucket, name, cost } of locked) {
            const result = await unit.buckets.take(bucket.key, cost, bucket.limit);
            // Only a clock that stepped back since the check lands here: the unit rolls back whole.
            if (!result.ok) throw new StoreRefusal(result.retryAfter ?? 1);
            taken.push({ name, cost });
          }
          drawn.push(...taken);
        });
      } catch (error) {
        for (const name of marked) drawing.delete(drawKey(name));
        if (!(error instanceof StoreRefusal)) {
          for (const name of heldNames) putBack(scope, name);
          throw error;
        }
        wait = error.wait;
      }
      for (const name of marked) drawing.delete(drawKey(name));
      // A refused request settles nothing and gives its held tokens back; the one token a request
      // that was served did not spend stays held with the rest of its draw.
      if (wait === undefined) {
        for (const { name, cost } of drawn) settle(scope, name, cost - 1, started);
      } else {
        for (const name of heldNames) putBack(scope, name);
      }
      return wait;
    },
  };
}
