import type { Clock } from '../kernel/clock.ts';
import type { ProcessAllowance, RateBucket } from './process-allowance.ts';

const defaultHoldMs = 1000;
const defaultMost = 10_000;
/** The most tokens one draw takes beyond the one it spends. */
const mostDraw = 10;

interface Held {
  tokens: number;
  takenAt: Temporal.Instant;
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

/**
 * A process's allowance of the shared rate buckets (S-143, decision 156): a request that finds the
 * bucket's tokens held takes one without a store round trip; a request that does not draws up to
 * a tenth of the bucket's capacity (at most 10 tokens) in the same unit that takes its own, and
 * while that draw is in flight the requests that miss take one token each, so a process never
 * holds more than one draw per bucket. Held tokens lapse `holdMs` after the draw and are never
 * returned to the store, so across processes at most `n - 1` tokens per process are lost or spent
 * early. The buckets of a request are taken in the order given and the first refusal stops the
 * rest: a refused request spends no token of the buckets after the one that refused, and the
 * tokens it already took go back into the process's own held tokens.
 */
export function createProcessAllowance(options: {
  readonly clock: Clock;
  /** How long taken tokens are held, and how long a draw counts as recent; default 1,000. */
  readonly holdMs?: number;
  /** The most buckets held; default 10,000, the least recently used dropped. */
  readonly most?: number;
}): ProcessAllowance {
  const holdMs = options.holdMs ?? defaultHoldMs;
  const most = options.most ?? defaultMost;
  const held = new Map<string, Held>();
  const drawing = new Set<string>();
  const freshOf = (entry: Held | undefined, now: Temporal.Instant): entry is Held =>
    entry !== undefined && now.since(entry.takenAt).total('milliseconds') < holdMs;
  const remember = (name: string, entry: Held): void => {
    held.delete(name);
    held.set(name, entry);
    while (held.size > most) {
      const oldest = held.keys().next();
      if (oldest.done === true) break;
      held.delete(oldest.value);
    }
  };
  /** Takes a held token when the bucket holds one that has not lapsed. */
  const takeHeld = (name: string): boolean => {
    const entry = held.get(name);
    if (!freshOf(entry, options.clock.now()) || entry.tokens < 1) return false;
    entry.tokens -= 1;
    remember(name, entry);
    return true;
  };
  /** Puts a held token back; a bucket whose tokens lapsed or were dropped gets nothing. */
  const putBack = (name: string): void => {
    const entry = held.get(name);
    if (freshOf(entry, options.clock.now())) entry.tokens += 1;
  };
  /**
   * Adds the tokens a draw left to what is held now: requests that overlap each add their own,
   * and the entry's time never moves back to an earlier request's start. An entry that lapsed
   * while the unit ran counts as 0 and the new tokens are dated from the start of their request.
   */
  const settle = (name: string, tokens: number, started: Temporal.Instant): void => {
    const current = held.get(name);
    const live = freshOf(current, options.clock.now());
    const takenAt =
      live && Temporal.Instant.compare(current.takenAt, started) > 0 ? current.takenAt : started;
    remember(name, { tokens: (live ? current.tokens : 0) + tokens, takenAt });
  };

  return {
    async take(target, buckets, dry) {
      const started = options.clock.now();
      if (buckets.some((bucket) => !usable(bucket.limit))) return 1;
      const names = buckets.map((bucket) => `${target.namespace.id}\u0000${bucket.key}`);
      if (dry) {
        const pending = buckets.filter((_bucket, at) => {
          const entry = held.get(names[at] ?? '');
          return !(freshOf(entry, started) && entry.tokens >= 1);
        });
        if (pending.length === 0) return undefined;
        let wait: number | undefined;
        await target.handle.adapter.unit(
          target.namespace,
          target.scope,
          async (unit) => {
            wait = undefined;
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
        if (!takeHeld(name)) break;
        heldNames.push(name);
        next += 1;
      }
      if (next === buckets.length) return undefined;
      // This request draws up to n tokens of a bucket that was fresh and empty when it began, unless
      // another request of this process is drawing already: one draw per bucket is in flight.
      const marked: string[] = [];
      const costs = buckets.map((bucket, at) => {
        const name = names[at] ?? '';
        const entry = held.get(name);
        if (at < next || !freshOf(entry, started) || entry.tokens >= 1 || drawing.has(name))
          return 1;
        drawing.add(name);
        marked.push(name);
        return drawOf(bucket.limit);
      });
      const drawn: { name: string; cost: number }[] = [];
      let wait: number | undefined;
      try {
        await target.handle.adapter.unit(target.namespace, target.scope, async (unit) => {
          // A unit that runs again starts from nothing: what an earlier attempt took is given back.
          for (const name of heldNames.splice(next)) putBack(name);
          drawn.length = 0;
          wait = undefined;
          for (let at = next; at < buckets.length; at += 1) {
            const bucket = buckets[at];
            const name = names[at];
            if (bucket === undefined || name === undefined) continue;
            if (takeHeld(name)) {
              heldNames.push(name);
              continue;
            }
            let cost = costs[at] ?? 1;
            let taken = await unit.buckets.take(bucket.key, cost, bucket.limit);
            if (!taken.ok && cost > 1) {
              cost = 1;
              taken = await unit.buckets.take(bucket.key, cost, bucket.limit);
            }
            if (!taken.ok) {
              wait = taken.retryAfter ?? 1;
              return;
            }
            drawn.push({ name, cost });
          }
        });
      } catch (error) {
        for (const name of heldNames) putBack(name);
        for (const name of marked) drawing.delete(name);
        throw error;
      }
      for (const name of marked) drawing.delete(name);
      // The one token the refused request did not spend stays held with the rest of its draw.
      for (const { name, cost } of drawn)
        settle(name, wait === undefined ? cost - 1 : cost, started);
      if (wait !== undefined) for (const name of heldNames) putBack(name);
      return wait;
    },
  };
}
