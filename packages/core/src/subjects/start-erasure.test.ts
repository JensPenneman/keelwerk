import { beforeEach, describe, expect, test, vi } from 'vitest';
import { errors } from '../errors/errors.ts';
import type { ErasureRecord } from '../ledger/erasure-record.ts';
import type { StoredJob } from '../storage/stored-job.ts';
import type { RunJobContext } from '../worker/run-job.ts';
import { startErasure } from './start-erasure.ts';

const admit = vi.hoisted(() => vi.fn<(...args: unknown[]) => Promise<void>>());
vi.mock('./admit-erasure.ts', () => ({ admitErasure: admit }));

const subjectId = '0192f3a0-0000-7000-8000-0000000000a1';
const tenantId = '0192f3a0-0000-7000-8000-000000000001';
const commandId = '0192f3a0-0000-7000-8000-0000000000c1';
const now = Temporal.Instant.from('2026-11-12T09:00:00Z');

interface Setup {
  readonly receipt?: { status: string; action: string; expiresAt: Temporal.Instant };
  readonly ledger?: readonly ErasureRecord[];
  readonly known?: boolean;
  /** A row of a tenant entity names the subject, but no key and no reference does (a passkey-only user). */
  readonly ownedRow?: boolean;
  /** The worker shredded the subject's key already: no live key, but a shredded one. */
  readonly shredded?: boolean;
  /** The key read fails as the SQL key store does when the serving directory does not hold the scope. */
  readonly keyScopeGone?: boolean;
}

function setup({
  receipt,
  ledger = [],
  known = true,
  ownedRow = false,
  shredded = false,
  keyScopeGone = false,
}: Setup = {}) {
  const completed: unknown[] = [];
  const appended: unknown[] = [];
  const sunk = vi.fn(async (_records: readonly unknown[]) => undefined);
  const unit = {
    receipts: { get: async () => receipt },
    keys: {
      dataKey: async () => {
        if (keyScopeGone) throw errors.not_found('No scope to wrap a key under.');
        return known ? {} : undefined;
      },
      shreddedKeys: async () => (shredded ? [{ keyId: 'k1', shreddedAt: now }] : []),
      refs: async () => [],
    },
    rows: {
      find: async () => ({
        rows: ownedRow ? [{ id: 'row-1' }] : [],
        pageInfo: {
          hasNextPage: false,
          hasPreviousPage: false,
          startCursor: null,
          endCursor: null,
        },
      }),
    },
    jobs: {
      complete: async (_attempt: unknown, _worker: string, outcome: unknown) => {
        completed.push(outcome);
        return true;
      },
    },
  };
  const context = {
    worker: 'w',
    clock: { now: () => now },
    source: {
      namespace: { id: 'ns' },
      registry: {
        entities: new Map([
          [
            'x.thing',
            {
              ref: 'x.thing',
              module: 'x',
              descriptor: {
                ref: 'x.thing',
                tenancy: 'tenant',
                dataSubject: 'owner',
                fields: { owner: { kind: 'subject' } },
              },
            },
          ],
        ]),
      },
      handle: {
        adapter: {
          unit: async (_ns: unknown, _scope: unknown, run: (unit: unknown) => unknown) => run(unit),
        },
      },
    },
    control: {
      ledger: {
        append: async (record: unknown) => {
          appended.push(record);
          return 1n;
        },
        since: async (seq: bigint) =>
          ledger.map((record, at) => ({ seq: BigInt(at + 1), record })).filter((e) => e.seq > seq),
        find: async (
          lookups: readonly {
            type: string;
            tenantId?: string;
            commandId?: string;
            subjectId?: string;
          }[],
        ) =>
          ledger
            .map((record: { type: string }, at) => ({ seq: BigInt(at + 1), record }))
            .filter(({ record }) =>
              lookups.some(
                (lookup) =>
                  record.type === lookup.type &&
                  Object.entries(lookup).every(
                    ([key, value]) => (record as Record<string, unknown>)[key] === value,
                  ),
              ),
            ),
      },
    },
    ledgers: [{ append: sunk }],
  } as unknown as RunJobContext;
  const stored = {
    scope: { level: 'tenant', backendId: 'b', tenantId },
    run: { action: 'core.eraseSubject', input: {}, commandId },
    attempt: { jobId: '1', attempt: 1 },
    principal: { resolver: 'core.operator', principalId: 'op-1' },
    causation: {},
  } as unknown as StoredJob;
  return { context, stored, completed, appended, sunk };
}

const accepted = {
  status: 'accepted',
  action: 'core.eraseSubject',
  expiresAt: now.add({ hours: 1 }),
};
const input = { subjectId, reason: 'subjectRequest' };
const record: ErasureRecord = {
  type: 'erasure',
  tenantId,
  subjectId,
  recordedAt: '2026-11-12T08:00:00.000Z',
  requester: { kind: 'operator', id: null, via: 'core.operator' },
  reason: 'subjectRequest',
  commandId,
};

beforeEach(() => {
  admit.mockReset().mockResolvedValue(undefined);
});

describe('only the accepted command starts an erasure', () => {
  test('a job with no receipt fails without a retry and records nothing', async () => {
    const { context, stored, appended, sunk, completed } = setup();
    await expect(startErasure(context, stored, input)).rejects.toMatchObject({
      kind: 'internal',
      code: 'core.request_not_allowed',
    });
    expect(appended).toEqual([]);
    expect(sunk).not.toHaveBeenCalled();
    expect(completed).toEqual([]);
  });

  test('a receipt older than its window still starts the erasure', async () => {
    const { context, stored, appended, completed } = setup({
      receipt: { ...accepted, expiresAt: now.subtract({ hours: 400 * 24 }) },
    });
    await startErasure(context, stored, input);
    expect(appended).toMatchObject([{ type: 'erasure', tenantId, subjectId, commandId }]);
    expect(completed).toEqual([{ kind: 'succeeded' }]);
  });

  test("an operator's erasure is admitted by the hold check right before its record, and one that is put off records nothing", async () => {
    const order: string[] = [];
    admit.mockImplementation(async () => {
      order.push('admit');
    });
    const first = setup({ receipt: accepted });
    (first.stored as { causation: unknown }).causation = {
      actor: { kind: 'operator', id: 'op-1', via: 'core.operator' },
    };
    first.context.control.ledger.append = async () => {
      order.push('record');
      return 1n;
    };
    await startErasure(first.context, first.stored, input);
    expect(order).toEqual(['admit', 'record']);
    const request = admit.mock.calls[0]?.[2];
    expect(request).not.toHaveProperty('entity');
    expect(request).toMatchObject({
      requester: { kind: 'operator', id: 'op-1', roles: [], via: 'core.operator' },
    });
    const held = setup({ receipt: accepted });
    admit.mockImplementation(() => {
      throw new Error('held');
    });
    await expect(startErasure(held.context, held.stored, input)).rejects.toThrow('held');
    expect(held.appended).toEqual([]);
    expect(held.sunk).not.toHaveBeenCalled();
    expect(held.completed).toEqual([]);
  });

  test('a receipt of another action, or one that is not accepted, does not start an erasure', async () => {
    for (const receipt of [
      { ...accepted, action: 'shop.refund' },
      { ...accepted, status: 'completed' },
      { ...accepted, status: 'failed' },
    ]) {
      const { context, stored, appended } = setup({ receipt });
      await expect(startErasure(context, stored, input)).rejects.toMatchObject({
        code: 'core.request_not_allowed',
      });
      expect(appended).toEqual([]);
    }
  });

  test('the accepted receipt lets it record the erasure and complete the job', async () => {
    const { context, stored, appended, sunk, completed } = setup({ receipt: accepted });
    await startErasure(context, stored, input);
    expect(appended).toMatchObject([{ type: 'erasure', tenantId, subjectId, commandId }]);
    expect(sunk).toHaveBeenCalledTimes(1);
    expect(completed).toEqual([{ kind: 'succeeded' }]);
  });

  test('a job that names an entity of a module under a command id a caller chose is refused', async () => {
    const { context, stored, appended, completed } = setup({ receipt: accepted });
    await expect(
      startErasure(context, stored, { ...input, entity: 'x.thing' }),
    ).rejects.toMatchObject({ code: 'core.request_not_allowed' });
    expect(appended).toEqual([]);
    expect(completed).toEqual([]);
  });

  test('an unknown subject is not_found even with the receipt', async () => {
    const { context, stored, appended } = setup({ receipt: accepted, known: false });
    await expect(startErasure(context, stored, input)).rejects.toMatchObject({
      code: 'core.not_found',
    });
    expect(appended).toEqual([]);
  });
});

describe('a subject that is known by its rows alone', () => {
  test('a row that names the subject makes it known, with no key and no reference', async () => {
    const { context, stored, appended } = setup({
      receipt: accepted,
      known: false,
      ownedRow: true,
    });
    await startErasure(context, stored, input);
    expect(appended).toMatchObject([{ type: 'erasure', subjectId }]);
  });

  test('a key the worker shredded already makes it known, with no live key, no reference and no row', async () => {
    const { context, stored, appended } = setup({
      receipt: accepted,
      known: false,
      shredded: true,
    });
    await startErasure(context, stored, input);
    expect(appended).toMatchObject([{ type: 'erasure', subjectId }]);
  });

  test('the record holds the canonical form of the subject, however the input spells it', async () => {
    const compact = subjectId.replaceAll('-', '');
    const { context, stored, appended } = setup({ receipt: accepted });
    await startErasure(context, stored, { ...input, subjectId: compact });
    expect(appended).toMatchObject([{ type: 'erasure', subjectId }]);
  });

  test('a record of the other spelling of the subject is the same erasure', async () => {
    const compact = subjectId.replaceAll('-', '');
    const { context, stored, appended, completed } = setup({ ledger: [record], known: false });
    await startErasure(context, stored, { ...input, subjectId: compact });
    expect(completed).toEqual([{ kind: 'succeeded' }]);
    expect(appended).toEqual([]);
  });
});

describe('a subject whose key cannot be opened because its scope is archived', () => {
  test('stays known: the accepted erasure is recorded, not refused', async () => {
    const { context, stored, appended, completed } = setup({
      receipt: accepted,
      known: false,
      keyScopeGone: true,
    });
    await startErasure(context, stored, input);
    expect(appended).toMatchObject([{ type: 'erasure', subjectId }]);
    expect(completed).toEqual([{ kind: 'succeeded' }]);
  });
});

describe('an attempt that runs again after the record is written', () => {
  test('completes at once, before any receipt or key is looked at', async () => {
    const { context, stored, appended, completed } = setup({ ledger: [record], known: false });
    await startErasure(context, stored, input);
    expect(completed).toEqual([{ kind: 'succeeded' }]);
    expect(appended).toEqual([]);
  });

  test('the record counts only with the same tenant, command id and subject', async () => {
    for (const other of [
      { ...record, tenantId: '0192f3a0-0000-7000-8000-000000000002' },
      { ...record, commandId: '0192f3a0-0000-7000-8000-0000000000c2' },
      { ...record, subjectId: '0192f3a0-0000-7000-8000-0000000000a2' },
    ]) {
      const { context, stored, completed } = setup({ ledger: [other] });
      await expect(startErasure(context, stored, input)).rejects.toMatchObject({
        code: 'core.request_not_allowed',
      });
      expect(completed).toEqual([]);
    }
  });
});
