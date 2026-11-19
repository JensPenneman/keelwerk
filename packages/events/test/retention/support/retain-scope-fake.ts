import type { PurgeBatch, Registry, RetentionRun, StorageScope } from '@keelwerk/core';
import type { InsideUnit } from '../../../src/retention/inside-unit.ts';
import type { RetainScopeInput } from '../../../src/retention/retain-scope.ts';
import { retainScope } from '../../../src/retention/retain-scope.ts';
import type { RetentionScope } from '../../../src/retention/retention-scope.ts';

/**
 * What a fake store answers for a purge: a count (which says candidates are left when it fills the
 * batch of ten) or the whole answer.
 */
type Answer = number | PurgeBatch;

/** What the fake store answers for a purge: its batches, in order. */
interface Script {
  transient?: readonly Answer[];
  jobs?: readonly Answer[];
  tickets?: readonly Answer[];
  expire?: readonly number[];
  failTransientAt?: number;
  /** A second stream with a declared retention; the one named here fails when it expires. */
  secondStream?: boolean;
  failStream?: string;
  /** The receipt step finds a full page that nobody could purge (a concurrent unit took the rows). */
  receiptsStuck?: boolean;
  /** The locking read of the receipt step finds nothing (another pass took the rows), yet an expired receipt is left. */
  receiptsLeft?: boolean;
}

const now = Temporal.Instant.from('2026-11-18T12:00:00Z');
const clock = { now: () => now };
const rules = { transientRecords: 'P7D', jobHistory: 'P7D', streamTickets: 'P1D' };
const guard = <T>(work: () => Promise<T>): Promise<T> => work();
export const backendId = '00000000-0000-4000-8000-0000000000b1';
export const tenantUuid = '00000000-0000-4000-8000-0000000000a1';
export const retainedTenantScope: StorageScope = {
  level: 'tenant',
  backendId,
  tenantId: tenantUuid,
};

/** A scope over a registry with one stream that declares a retention, on a store that counts. */
export function retentionScopeOf(
  level: StorageScope,
  namespaceId: string,
  script: Script = {},
  tenancy: 'tenant' | 'backend' | 'invocation' = 'tenant',
): {
  readonly scope: RetentionScope;
  readonly calls: string[];
  readonly purgedTypes: (readonly string[])[];
} {
  const calls: string[] = [];
  const purgedTypes: (readonly string[])[] = [];
  const at = { transient: 0, jobs: 0, tickets: 0, expire: 0 };
  const next = (list: readonly Answer[] | undefined, key: keyof typeof at): PurgeBatch => {
    const answer = list?.[at[key]] ?? 0;
    at[key] += 1;
    return typeof answer === 'number' ? { removed: answer, more: answer === 10 } : answer;
  };
  const nextCount = (list: readonly number[] | undefined, key: keyof typeof at): number =>
    next(list, key).removed;
  const unit = {
    events: {
      purgeTransient: async (_before: unknown, _limit: unknown, types: readonly string[]) => {
        calls.push('transient');
        purgedTypes.push(types);
        if (script.failTransientAt === at.transient) throw new Error('a stored message');
        return next(script.transient, 'transient');
      },
    },
    jobs: {
      purgeHistory: async () => {
        calls.push('jobs');
        return next(script.jobs, 'jobs');
      },
    },
    rows: {
      find: async (_descriptor: unknown, query: { readonly forUpdate?: boolean }) => ({
        rows: script.receiptsStuck
          ? [1, 2].map((n) => ({
              id: `r${n}`,
              commandId: `c${n}`,
              action: 'shelf.lend',
              outcome: null,
            }))
          : script.receiptsLeft && query.forUpdate !== true
            ? [{ id: 'r1' }]
            : [],
      }),
      purge: async () => 0,
    },
    streams: {
      expire: async (ref: string) => {
        if (script.failStream === ref) throw new Error('a stored message');
        calls.push('expire');
        return nextCount(script.expire, 'expire');
      },
    },
    keys: { destroyValueKey: async () => undefined },
  };
  const registry = {
    entities: new Map([
      ['shelf.book', { descriptor: { tenancy } }],
      ['core.commandReceipt', { descriptor: { tenancy } }],
    ]),
    actions: new Map(),
    streams: new Map([
      ['shelf.log', { ref: 'shelf.log', readAs: 'shelf.book', retention: { maxAge: 'P1D' } }],
      ...(script.secondStream === true
        ? [
            [
              'shelf.audit',
              { ref: 'shelf.audit', readAs: 'shelf.book', retention: { maxAge: 'P2D' } },
            ] as const,
          ]
        : []),
    ]),
  } as unknown as Registry;
  const scope: RetentionScope = {
    target: {
      scope: level,
      namespace: { id: namespaceId },
      handle: {
        adapter: {
          unit: async (_n: unknown, _s: unknown, fn: (u: unknown) => unknown) => fn(unit),
        },
      },
    },
    registry,
    backendId: level.level === 'deployment' ? 'deployment-1' : backendId,
    tenantId: level.level === 'tenant' ? tenantUuid : null,
  } as unknown as RetentionScope;
  return { scope, calls, purgedTypes };
}

export const retainFully = (
  scope: RetentionScope,
  batchSize = 10,
  insideUnit?: InsideUnit,
  pace: Partial<Pick<RetainScopeInput, 'maxBatches' | 'mayContinue'>> = {},
) =>
  retainScope({
    scope,
    now,
    clock,
    rules,
    batchSize,
    maxBatches: 1_000_000,
    mayContinue: async () => true,
    ...pace,
    guard,
    ...(insideUnit === undefined ? {} : { insideUnit }),
  });

export const retain = (
  scope: RetentionScope,
  batchSize = 10,
  insideUnit?: InsideUnit,
): Promise<RetentionRun | undefined> =>
  retainFully(scope, batchSize, insideUnit).then((result) => result.run);

/** A seam that throws `error` in the units of one buffer. */
export const failing =
  (buffer: string, error: () => unknown): InsideUnit =>
  async (_scope, opened) => {
    if (opened === buffer) throw error();
  };
