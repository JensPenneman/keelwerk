import { describe, expect, test } from 'vitest';
import type { LedgerRecord } from '../kernel/ledger-record.ts';
import { erasureKeys } from './erasure-keys.ts';

const tenantId = '0192f3a0-0000-7000-8000-000000000001';
const otherTenantId = '0192f3a0-0000-7000-8000-000000000002';
const adaId = '0192f3a0-0000-7000-8000-0000000000a1';

/** A control ledger and a sink in memory, and one tenant whose subject has two shredded data keys. */
function setup(options: { readonly otherTenant?: boolean; readonly failFirst?: boolean } = {}) {
  const erasure = (tenant: string, commandId: string): LedgerRecord => ({
    type: 'erasure',
    tenantId: tenant,
    subjectId: adaId,
    recordedAt: '2026-11-12T08:00:00.000Z',
    requester: { kind: 'operator', id: null, via: 'core.operator' },
    reason: 'subjectRequest',
    commandId,
  });
  const control: LedgerRecord[] = [erasure(tenantId, 'c1')];
  // The first record's tenant has a unit that throws; the second record's tenant is fine.
  if (options.otherTenant === true) control.push(erasure(otherTenantId, 'c2'));
  const sink: LedgerRecord[] = [];
  const created: unknown[] = [];
  const logged: { readonly message: string; readonly fields: Record<string, unknown> }[] = [];
  const unitOf = (tenant: string) => ({
    scope: { level: 'tenant', backendId: 'b1', tenantId: tenant },
    keys: {
      shred: async () => ({ keyIds: [] }),
      shreddedKeys: async () =>
        tenant === otherTenantId
          ? [{ keyId: 'k3', shreddedAt: Temporal.Instant.from('2026-11-12T08:00:01Z') }]
          : [
              { keyId: 'k1', shreddedAt: Temporal.Instant.from('2026-11-12T08:00:01Z') },
              { keyId: 'k2', shreddedAt: Temporal.Instant.from('2026-11-12T08:00:01Z') },
            ],
      dataKey: async (_subjectId: string, createOptions: unknown) => {
        if (options.failFirst === true && tenant === tenantId) {
          throw new Error('unsupported: configure keyWrapper');
        }
        created.push(createOptions);
        return undefined;
      },
      destroyValueKey: async () => undefined,
    },
  });
  const source = {
    namespace: { id: 'ns' },
    handle: {
      adapter: {
        unit: async (
          _ns: unknown,
          scope: { readonly tenantId: string },
          fn: (u: unknown) => unknown,
        ) => fn(unitOf(scope.tenantId)),
      },
    },
  };
  const context = {
    clock: { now: () => Temporal.Instant.from('2026-11-12T09:00:00Z') },
    control: {
      ledger: {
        append: async (record: LedgerRecord) => {
          control.push(record);
          return BigInt(control.length);
        },
        since: async (seq: bigint, limit: number) =>
          control
            .map((record, at) => ({ seq: BigInt(at + 1), record }))
            .filter((entry) => entry.seq > seq)
            .slice(0, limit),
      },
    },
    ledgers: [
      {
        append: async (records: readonly LedgerRecord[]) => {
          sink.push(...records);
        },
        read: async function* () {
          yield* sink;
        },
      },
    ],
    directory: {
      tenant: async (id: string) => ({ id, backendId: 'b1', namespace: { id: 'ns' } }),
    },
    log: {
      error: (message: string, fields: Record<string, unknown>) => {
        logged.push({ message, fields });
      },
    },
    namespaces: [source],
  };
  const input = { connected: { keys: { invalidate: () => undefined } } };
  return { control, sink, created, logged, context, service: erasureKeys(input as never) };
}

const tombstonesOf = (records: readonly LedgerRecord[]): string[] =>
  records.flatMap((record) => (record.type === 'keyTombstone' ? [record.keyId] : []));

describe('the key replay at boot', () => {
  test('runs the shred step of the erasure: a key is created for a subject that has none, between two shreds', async () => {
    const { created, context, service } = setup();
    await service.start(context as never);
    // A passkey-only subject owns no data key; the replay creates one so that the restored
    // placement gets a key shredded after the completion, as step 2 of the erasure itself does.
    expect(created).toEqual([{ create: true }]);
  });

  test('appends the tombstone of each shredded key once, however many boots run', async () => {
    const { control, sink, context, service } = setup();
    await service.start(context as never);
    expect(tombstonesOf(control).sort()).toEqual(['k1', 'k2']);
    expect(tombstonesOf(sink).sort()).toEqual(['k1', 'k2']);
    await service.start(context as never);
    await service.start(context as never);
    expect(tombstonesOf(control).sort()).toEqual(['k1', 'k2']);
    expect(tombstonesOf(sink).sort()).toEqual(['k1', 'k2']);
  });

  test('a key the union holds a tombstone for is not appended again, one it lacks is', async () => {
    const { control, sink, context, service } = setup();
    sink.push({
      type: 'keyTombstone',
      scopeId: tenantId,
      keyId: 'k1',
      recordedAt: '2026-11-12T08:00:01.000Z',
      reason: 'erasure',
    });
    await service.start(context as never);
    // The union already holds k1, so only k2 is appended.
    expect(tombstonesOf(control)).toEqual(['k2']);
    expect(tombstonesOf(sink).sort()).toEqual(['k1', 'k2']);
  });

  test('a record whose unit throws does not stop the records after it', async () => {
    const { control, sink, logged, context, service } = setup({
      otherTenant: true,
      failFirst: true,
    });
    await service.start(context as never);
    // The first record (a store without a key wrapper) fails; the second still shreds and appends.
    expect(tombstonesOf(control)).toEqual(['k3']);
    expect(tombstonesOf(sink)).toEqual(['k3']);
    // The log names the tenant and the command id, never the subject.
    expect(logged).toHaveLength(1);
    expect(logged[0]?.fields).toMatchObject({ tenantId, commandId: 'c1' });
    expect(JSON.stringify(logged[0]?.fields.tenantId) + String(logged[0]?.message)).not.toContain(
      adaId,
    );
    expect(Object.keys(logged[0]?.fields ?? {})).not.toContain('subjectId');
  });
});
