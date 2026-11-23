import type { ControlLeaseStore } from '../control/control-lease-store.ts';
import { presumedGoneAfterMs } from '../control/presumed-gone-after-ms.ts';
import { coreErrorCodes } from '../errors/core-error-codes.ts';
import { KeelwerkError } from '../errors/keelwerk-error.ts';

const kinds: readonly ConcurrencyKind[] = ['subscriptions', 'connections', 'invocations'];
const sweepLimit = 1_000;

interface Waiting {
  readonly request: ConcurrencyTake;
  readonly resolve: (release: () => void) => void;
  readonly reject: (error: unknown) => void;
}

/** One (kind, scope): the slots in use, the units its lease row holds, and the takes the next write answers. */
interface Pair {
  readonly kind: ConcurrencyKind;
  readonly scopeId: string;
  used: number;
  held: number;
  writing: boolean;
  waiting: Waiting[];
}

/** What one `take` asks for. */
interface ConcurrencyTake {
  readonly kind: ConcurrencyKind;
  /** The tenant, or the backend for a backend-scope request: the id the count is kept for. */
  readonly scopeId: string;
  /** The quota the count is limited by, named in the refusal (`core.liveSubscriptions`). */
  readonly dimension: string;
  readonly limit: number;
}

function refusal(request: ConcurrencyTake): KeelwerkError {
  return new KeelwerkError({
    ...coreErrorCodes['core.concurrency_limited'],
    code: 'core.concurrency_limited',
    details: { dimension: request.dimension, limit: request.limit },
    retryAfter: 1,
  });
}

/** The three counts the deployment keeps through leases (12.2, 15.4.10), the kind of their lease rows. */
export type ConcurrencyKind = 'subscriptions' | 'connections' | 'invocations';

/** This process's slots of the counts the deployment keeps (design of WP-117). */
export interface ConcurrencyLeases {
  /**
   * Answers the release of one slot, once; past the limit across the deployment: `rate_limited`
   * `core.concurrency_limited`.
   */
  take(request: ConcurrencyTake): Promise<() => void>;
  /**
   * The periodic pass: renews the leases, writes what changed since the last write, sweeps the
   * expired leases of the three kinds.
   */
  pass(): Promise<void>;
}

/** What the counter needs of the control store: one writing unit over the lease store, and who holds the leases. */
export interface ConcurrencyLeasesInput {
  readonly holder: string;
  readonly run: <T>(fn: (leases: ControlLeaseStore) => Promise<T>) => Promise<T>;
}

/**
 * The one place that decides the limits of the three counts across the deployment. Each process keeps
 * for every (kind, scope) the slots it uses and the units its lease row holds; a slot that ends is
 * only counted down, and a take within the held units costs no write. A take beyond them waits for
 * the next write of its pair, which answers every take that waits at once in one unit of the control
 * store: it holds the units wanted, and when the total of all holders is above the limit it holds
 * only what fits (at least what is in use), so no other holder reads the excess. At most one write
 * of a pair is in flight. A failed write refuses the takes it answered with the store's error and
 * leaves the pair as it was; the takes that arrived while it ran get the next write of the pair,
 * except after a failed write that answered no take of its own, which refuses them with its error.
 *
 * The limit of a take is decided only in a write, so a lowered limit closes nothing: a take within
 * the held units is admitted whatever the limit now is, the pass gives the units that are not in use
 * back, and a lease that lapsed is held again at what is in use.
 */
export function createConcurrencyLeases(input: ConcurrencyLeasesInput): ConcurrencyLeases {
  const { holder, run } = input;
  const pairs = new Map<string, Pair>();
  const keyOf = (kind: string, scopeId: string): string => `${kind}\u0000${scopeId}`;

  const grantOf = (pair: Pair): (() => void) => {
    pair.used += 1;
    let given = false;
    return () => {
      if (given) return;
      given = true;
      pair.used -= 1;
    };
  };

  /**
   * One unit: the pair's lease holds `used` and the takes waiting, trimmed to the limit. Answers the
   * function that settles those takes; a failed write with no take to refuse throws.
   */
  const writeOnce = async (pair: Pair): Promise<() => void> => {
    const takes = pair.waiting.splice(0);
    const inUse = pair.used;
    const wanted = inUse + takes.length;
    const limit = takes.at(-1)?.request.limit;
    const lease = { kind: pair.kind, scopeId: pair.scopeId, key: pair.scopeId, holder } as const;
    try {
      const units = await run(async (leases) => {
        if (wanted === 0) {
          await leases.release(pair.kind, pair.scopeId, holder);
          return 0;
        }
        const { total } = await leases.hold({ ...lease, units: wanted }, presumedGoneAfterMs);
        if (limit === undefined || total <= limit) return wanted;
        const fitting = Math.max(inUse, wanted - (total - limit));
        if (fitting === 0) await leases.release(pair.kind, pair.scopeId, holder);
        else await leases.hold({ ...lease, units: fitting }, presumedGoneAfterMs);
        return fitting;
      });
      pair.held = units;
      return () =>
        takes.forEach((take, index) => {
          if (index < units - inUse) take.resolve(grantOf(pair));
          else take.reject(refusal(take.request));
        });
    } catch (error) {
      if (takes.length === 0) throw error;
      return () => {
        for (const take of takes) take.reject(error);
      };
    }
  };

  const forgetIfIdle = (pair: Pair): void => {
    if (pair.used === 0 && pair.held === 0 && pair.waiting.length === 0 && !pair.writing) {
      pairs.delete(keyOf(pair.kind, pair.scopeId));
    }
  };

  /**
   * Writes until no take waits; the caller found the pair idle. The pair is idle again before the
   * takes of the last write are answered, so a take that follows its answer finds the held units.
   */
  const settle = async (pair: Pair): Promise<void> => {
    pair.writing = true;
    try {
      for (let more = true; more; ) {
        const answer = await writeOnce(pair);
        more = pair.waiting.length > 0;
        pair.writing = more;
        answer();
      }
    } catch (error) {
      // A write with no take of its own failed: the takes that arrived while it ran get its error, none stays waiting.
      pair.writing = false;
      for (const waiting of pair.waiting.splice(0)) waiting.reject(error);
      throw error;
    } finally {
      forgetIfIdle(pair);
    }
  };

  const take = (request: ConcurrencyTake): Promise<() => void> => {
    const id = keyOf(request.kind, request.scopeId);
    let pair = pairs.get(id);
    if (pair === undefined) {
      pair = {
        kind: request.kind,
        scopeId: request.scopeId,
        used: 0,
        held: 0,
        writing: false,
        waiting: [],
      };
      pairs.set(id, pair);
    }
    if (!pair.writing && pair.used < pair.held) return Promise.resolve(grantOf(pair));
    const target = pair;
    return new Promise<() => void>((resolve, reject) => {
      target.waiting.push({ request, resolve, reject });
      if (!target.writing) {
        // The takes' own promises carry a failure; `settle` throws only for a write with no take.
        void settle(target).catch(() => undefined);
      }
    });
  };

  const renewMissing = async (idle: readonly Pair[]): Promise<readonly Pair[]> => {
    const missing = await run((leases) =>
      leases.renew(
        holder,
        idle.map((pair) => ({ kind: pair.kind, key: pair.scopeId })),
        presumedGoneAfterMs,
      ),
    );
    const lost = new Set(missing.map((one) => keyOf(one.kind, one.key)));
    return idle.filter((pair) => lost.has(keyOf(pair.kind, pair.scopeId)));
  };

  const pass = async (): Promise<void> => {
    const idle = [...pairs.values()].filter((pair) => !pair.writing);
    const slack = idle.filter((pair) => pair.held > pair.used);
    const whole = idle.filter((pair) => pair.held <= pair.used);
    const lost = whole.length === 0 ? [] : await renewMissing(whole);
    for (const pair of [...slack, ...lost]) {
      if (!pair.writing) await settle(pair);
    }
    await run(async (leases) => {
      for (const kind of kinds) await leases.expire(kind, sweepLimit);
    });
  };

  return { take, pass };
}
