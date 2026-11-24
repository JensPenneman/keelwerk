import type { ControlLeaseStore } from '../control/control-lease-store.ts';
import { presumedGoneAfterMs } from '../control/presumed-gone-after-ms.ts';
import { coreErrorCodes } from '../errors/core-error-codes.ts';
import { KeelwerkError } from '../errors/keelwerk-error.ts';

const kinds: readonly ConcurrencyKind[] = ['subscriptions', 'connections', 'invocations'];
const sweepLimit = 1_000;
/** The most pairs one renew carries (the lease store's rule); a pass cuts what it holds into parts of this size. */
const partSize = 1_000;

interface Waiting {
  readonly request: ConcurrencyTake;
  readonly resolve: (release: () => void) => void;
  readonly reject: (error: unknown) => void;
}

/**
 * One (kind, scope): the slots in use, the units its lease row holds, the units of all holders the
 * store last answered for it (`total`, `Infinity` after a lease held anew), the renew of the pass
 * that is writing it, and the takes the next write answers.
 */
interface Pair {
  readonly kind: ConcurrencyKind;
  readonly scopeId: string;
  used: number;
  held: number;
  total: number;
  renewal: Promise<void> | undefined;
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

/** The one rule that decides a limit: a count of slots is within it when it does not pass it. */
function within(count: number, limit: number): boolean {
  return count <= limit;
}

/** The three counts the deployment keeps through leases (12.2, 15.4.10), the kind of their lease rows. */
type ConcurrencyKind = 'subscriptions' | 'connections' | 'invocations';

/** This process's slots of the counts the deployment keeps (design of WP-117 and WP-216). */
export interface ConcurrencyLeases {
  /**
   * Answers the release of one slot, once; past the limit across the deployment: `rate_limited`
   * `core.concurrency_limited`.
   */
  take(request: ConcurrencyTake): Promise<() => void>;
  /**
   * The periodic pass: sets the leases to the slots in use, in parts of at most 1,000 pairs, and
   * sweeps the expired leases of the three kinds.
   */
  pass(): Promise<void>;
}

/** What the counter needs of the control store: one writing unit over the lease store, and who holds the leases. */
export interface ConcurrencyLeasesInput {
  readonly holder: string;
  readonly run: <T>(fn: (leases: ControlLeaseStore) => Promise<T>) => Promise<T>;
}

/**
 * The one place that decides the limits of the three counts across the deployment, by `within`.
 * Each process keeps for every (kind, scope) the slots it uses, the units its lease row holds and
 * the total of all holders the store last answered. A take is refused at once when the slots this
 * process uses already stand at its limit: they are part of every total, so no store could answer
 * lower. It costs no write when the pair holds a unit it does not use and the last total is within
 * the limit of the take: a reuse keeps that total. A pair with a write in flight and a pair whose
 * lease was held anew (it has no total to trust) send the take to a write. Every other take waits
 * for the next write of its pair, which answers every take that waits at once in one unit of the
 * control store: it holds the units wanted and decides each take in order by the units of the other
 * holders and the units granted so far, against the limit of that take; it then holds the units
 * in use plus those granted. At most one write of a pair is in flight. A failed write refuses the
 * takes it answered with the store's error and leaves the pair as it was; the takes that arrived
 * while it ran get the next write.
 *
 * The pass sets the lease of every pair without a write in flight (that write sets it) to the
 * slots in use. A slot that ended counts until a write or a pass of its process that began after
 * it ended has set the lease of its pair, and at most until its lease lapses. When the total last
 * answered for a pair passes the limit of a take, only a write can admit that take, and the write
 * counts every holder, whatever the churn. The pass learns the total of each pair from the
 * statement that sets its lease.
 * Nothing that is open is closed.
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
   * One unit: the pair's lease holds the slots in use and the takes waiting, then only those that
   * fit, each take judged by its own limit. Answers the function that settles those takes.
   */
  const writeOnce = async (pair: Pair): Promise<() => void> => {
    const takes = pair.waiting.splice(0);
    const inUse = pair.used;
    const wanted = inUse + takes.length;
    const lease = { kind: pair.kind, scopeId: pair.scopeId, key: pair.scopeId, holder } as const;
    try {
      const outcome = await run(async (leases) => {
        const { total } = await leases.hold({ ...lease, units: wanted }, presumedGoneAfterMs);
        const others = total - wanted;
        let units = inUse;
        const admitted = takes.map((take) => {
          const fits = within(others + units + 1, take.request.limit);
          if (fits) units += 1;
          return fits;
        });
        if (units === wanted) return { units, others, admitted };
        if (units === 0) await leases.release(pair.kind, pair.scopeId, holder);
        else await leases.hold({ ...lease, units }, presumedGoneAfterMs);
        return { units, others, admitted };
      });
      pair.held = outcome.units;
      pair.total = outcome.others + outcome.units;
      return () =>
        takes.forEach((take, index) => {
          if (outcome.admitted[index]) take.resolve(grantOf(pair));
          else take.reject(refusal(take.request));
        });
    } catch (error) {
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
   * Writes until no take waits; the caller found the pair idle. A renew of the pass that is
   * writing the pair finishes first, so a write and a renew of one row never run side by side. The
   * pair is idle again before the takes of the last write are answered, so a take that follows its
   * answer finds the held units.
   */
  const settle = async (pair: Pair): Promise<void> => {
    pair.writing = true;
    try {
      if (pair.renewal !== undefined) await pair.renewal;
      for (let more = true; more; ) {
        const answer = await writeOnce(pair);
        more = pair.waiting.length > 0;
        pair.writing = more;
        answer();
      }
    } finally {
      forgetIfIdle(pair);
    }
  };

  const take = (request: ConcurrencyTake): Promise<() => void> => {
    const id = keyOf(request.kind, request.scopeId);
    let pair = pairs.get(id);
    if (!within((pair?.used ?? 0) + 1, request.limit)) return Promise.reject(refusal(request));
    if (pair === undefined) {
      pair = {
        kind: request.kind,
        scopeId: request.scopeId,
        used: 0,
        held: 0,
        total: 0,
        renewal: undefined,
        writing: false,
        waiting: [],
      };
      pairs.set(id, pair);
    }
    if (!pair.writing && pair.used < pair.held && within(pair.total, request.limit)) {
      return Promise.resolve(grantOf(pair));
    }
    const target = pair;
    return new Promise<() => void>((resolve, reject) => {
      target.waiting.push({ request, resolve, reject });
      if (!target.writing) void settle(target);
    });
  };

  /**
   * One part of the pass, in one unit: the lease of each pair is set to the slots in use at this
   * moment, which are also the units the fast path may reuse from now on. The pair is then known by
   * the total the store answered, or by none when its lease had lapsed: the answer can miss a take
   * another process admitted beside the renew, so the next take of that pair asks the store.
   */
  const renewPart = async (part: readonly Pair[]): Promise<void> => {
    let done!: () => void;
    const renewal = new Promise<void>((resolve) => {
      done = resolve;
    });
    const leases = part.map((pair) => {
      pair.renewal = renewal;
      pair.held = pair.used;
      return { kind: pair.kind, scopeId: pair.scopeId, key: pair.scopeId, units: pair.used };
    });
    try {
      const answers = await run((store) => store.renew(holder, leases, presumedGoneAfterMs));
      part.forEach((pair, index) => {
        const answer = answers[index];
        if (answer !== undefined)
          pair.total = answer.lapsed ? Number.POSITIVE_INFINITY : answer.total;
      });
    } finally {
      for (const pair of part) {
        pair.renewal = undefined;
        forgetIfIdle(pair);
      }
      done();
    }
  };

  const pass = async (): Promise<void> => {
    const listed = [...pairs.values()];
    for (let from = 0; from < listed.length; from += partSize) {
      // Built when the part starts: a pair that began a write meanwhile sets its own units, and a pair forgotten meanwhile is gone.
      const part = listed
        .slice(from, from + partSize)
        .filter((pair) => !pair.writing && pairs.get(keyOf(pair.kind, pair.scopeId)) === pair);
      if (part.length > 0) await renewPart(part);
    }
    await run(async (leases) => {
      for (const kind of kinds) await leases.expire(kind, sweepLimit);
    });
  };

  return { take, pass };
}
