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
 * a tenth of the bucket's capacity (at most 10 tokens) in the same unit that takes its own. Held
 * tokens lapse `holdMs` after the draw and are never returned, so across processes at most
 * `n - 1` tokens per process are lost or spent early.
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

  return {
    async take(target, buckets, dry) {
      const now = options.clock.now();
      let wait: number | undefined;
      const refuse = (seconds: number): void => {
        wait = Math.max(wait ?? 0, seconds);
      };
      const names = new Map<RateBucket, string>();
      const valid: RateBucket[] = [];
      for (const bucket of buckets) {
        if (usable(bucket.limit)) {
          valid.push(bucket);
          names.set(bucket, `${target.namespace.id}\u0000${bucket.key}`);
        } else refuse(1);
      }
      const nameOf = (bucket: RateBucket): string => names.get(bucket) ?? bucket.key;
      const pending: { bucket: RateBucket; fresh: boolean }[] = [];
      if (dry) {
        for (const bucket of valid) {
          const entry = held.get(nameOf(bucket));
          if (freshOf(entry, now) && entry.tokens >= 1) continue;
          pending.push({ bucket, fresh: false });
        }
        if (pending.length > 0) {
          await target.handle.adapter.unit(
            target.namespace,
            target.scope,
            async (unit) => {
              for (const { bucket } of pending) {
                const read = await unit.buckets.check(bucket.key, 1, bucket.limit);
                if (!read.ok) refuse(read.retryAfter ?? 1);
              }
            },
            { readOnly: true },
          );
        }
        return wait;
      }
      valid.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
      for (const bucket of valid) {
        const name = nameOf(bucket);
        const entry = held.get(name);
        const fresh = freshOf(entry, now);
        if (fresh && entry.tokens >= 1) {
          entry.tokens -= 1;
          remember(name, entry);
        } else pending.push({ bucket, fresh });
      }
      if (pending.length === 0) return wait;
      const drawn: { name: string; cost: number }[] = [];
      const refused: number[] = [];
      await target.handle.adapter.unit(target.namespace, target.scope, async (unit) => {
        drawn.length = 0;
        refused.length = 0;
        for (const { bucket, fresh } of pending) {
          let cost = fresh ? drawOf(bucket.limit) : 1;
          let taken = await unit.buckets.take(bucket.key, cost, bucket.limit);
          if (!taken.ok && cost > 1) {
            cost = 1;
            taken = await unit.buckets.take(bucket.key, cost, bucket.limit);
          }
          if (taken.ok) drawn.push({ name: nameOf(bucket), cost });
          else refused.push(taken.retryAfter ?? 1);
        }
      });
      const after = options.clock.now();
      for (const { name, cost } of drawn) {
        // Requests that overlap each add their draw to what is held now, never over it,
        // and the entry's time never moves back.
        const current = held.get(name);
        const base = freshOf(current, after) ? current.tokens : 0;
        const takenAt =
          current !== undefined && Temporal.Instant.compare(current.takenAt, now) > 0
            ? current.takenAt
            : now;
        remember(name, { tokens: base + cost - 1, takenAt });
      }
      for (const seconds of refused) refuse(seconds);
      return wait;
    },
  };
}
