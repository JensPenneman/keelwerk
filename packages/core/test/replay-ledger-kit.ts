import type { LedgerLookup } from '../src/control/ledger-lookup.ts';
import type { LedgerRecord } from '../src/kernel/ledger-record.ts';
import { readSinks } from '../src/runtime/read-sinks.ts';
import { replayLedger } from '../src/runtime/replay-ledger.ts';

function matches(lookup: LedgerLookup, record: LedgerRecord): boolean {
  if ('commandId' in lookup) {
    return (
      record.type === lookup.type &&
      record.tenantId === lookup.tenantId &&
      record.commandId === lookup.commandId &&
      record.subjectId === lookup.subjectId
    );
  }
  if (record.type !== 'keyTombstone') return false;
  return 'keyId' in lookup ? record.keyId === lookup.keyId : record.scopeId === lookup.scopeId;
}

export const ledgerTenantId = '0192f3a0-0000-7000-8000-000000000001';
export const otherTenantId = '0192f3a0-0000-7000-8000-000000000002';
export const adaId = '0192f3a0-0000-7000-8000-0000000000a1';

export const erasureRecord = (tenant: string, commandId: string): LedgerRecord => ({
  type: 'erasure',
  tenantId: tenant,
  subjectId: adaId,
  recordedAt: '2026-11-12T08:00:00.000Z',
  requester: { kind: 'operator', id: null, via: 'core.operator' },
  reason: 'subjectRequest',
  commandId,
});
export const tombstone = (
  keyId: string,
  scopeId = ledgerTenantId,
  reason: 'erasure' | 'rotation' = 'erasure',
): LedgerRecord => ({
  type: 'keyTombstone',
  scopeId,
  keyId,
  recordedAt: '2026-11-12T08:00:01.000Z',
  reason,
});
export const completed = (tenant: string, commandId: string, epoch: number): LedgerRecord => ({
  type: 'erasureCompleted',
  tenantId: tenant,
  commandId,
  subjectId: adaId,
  epoch,
  recordedAt: '2026-11-12T08:00:02.000Z',
});

/** A control ledger and a sink in memory, tenants that each hold shredded data keys, and a log. */
export function setupReplayLedger(
  options: {
    readonly control?: LedgerRecord[];
    readonly sink?: LedgerRecord[];
    readonly failTenant?: string;
    readonly epochs?: Map<string, number>;
    readonly rerun?: boolean;
    readonly failFind?: boolean;
    readonly failAppend?: boolean;
    readonly failDestroy?: boolean;
    readonly failDirectory?: boolean;
    /** Scope ids that are backends, not tenants. */
    readonly backends?: readonly string[];
  } = {},
) {
  const control: LedgerRecord[] = options.control ?? [];
  const sink: LedgerRecord[] = options.sink ?? [];
  const units: { readonly tenant: string; readonly readOnly: boolean }[] = [];
  const destroyed: { tenant: string; keyId: string }[] = [];
  const logged: { readonly message: string; readonly fields: Record<string, unknown> }[] = [];
  const warned: { readonly message: string; readonly fields: Record<string, unknown> }[] = [];
  const order: string[] = [];
  const entries = () => control.map((record, at) => ({ seq: BigInt(at + 1), record }));
  const epochs = options.epochs ?? new Map<string, number>();
  const ledger = {
    append: async (record: LedgerRecord) => {
      if (options.failAppend === true) throw new Error('the ledger is down');
      order.push('append');
      control.push(record);
      return BigInt(control.length);
    },
    since: async () => [],
    find: async (lookups: readonly LedgerLookup[], page?: { after?: bigint; limit?: number }) => {
      if (options.failFind === true) throw new Error('the ledger is down');
      return entries()
        .filter((entry) => entry.seq > (page?.after ?? 0n))
        .filter((entry) => lookups.some((lookup) => matches(lookup, entry.record)))
        .slice(0, page?.limit ?? 500);
    },
    unfinished: async (query: {
      epochs: ReadonlyMap<string, number>;
      after: bigint;
      limit: number;
    }) => {
      order.push('unfinished');
      const erasures = entries()
        .filter((entry) => entry.record.type === 'erasure' && entry.seq > query.after)
        .filter((entry) => {
          const record = entry.record;
          if (record.type !== 'erasure') return false;
          return !entries().some(
            (other) =>
              other.seq > entry.seq &&
              other.record.type === 'erasureCompleted' &&
              other.record.tenantId === record.tenantId &&
              other.record.commandId === record.commandId &&
              other.record.epoch === (query.epochs.get(record.tenantId) ?? 0),
          );
        })
        .map((entry) => ({
          seq: entry.seq,
          record: entry.record as never,
          rerun: options.rerun === true,
        }));
      return { erasures: erasures.slice(0, query.limit), head: BigInt(control.length) };
    },
  };
  const unitOf = (tenant: string, readOnly: boolean) => ({
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
      dataKey: async () => {
        if (options.failTenant === tenant) throw new Error('unsupported: configure keyWrapper');
        return undefined;
      },
      destroyValueKey: async (keyId: string) => {
        if (options.failDestroy === true) throw new Error('the key store is down');
        order.push('destroy');
        destroyed.push({ tenant, keyId });
      },
    },
    readOnly,
  });
  const source = {
    namespace: { id: 'ns' },
    handle: {
      adapter: {
        unit: async (
          _ns: unknown,
          scope: { readonly tenantId?: string; readonly backendId: string },
          fn: (u: unknown) => unknown,
          unitOptions?: { readonly readOnly?: boolean },
        ) => {
          const id = scope.tenantId ?? scope.backendId;
          units.push({ tenant: id, readOnly: unitOptions?.readOnly === true });
          return fn(unitOf(id, unitOptions?.readOnly === true));
        },
      },
    },
  };
  const log = {
    error: (message: string, fields: Record<string, unknown>) => {
      logged.push({ message, fields });
    },
    warn: (message: string, fields: Record<string, unknown>) => {
      warned.push({ message, fields });
    },
  };
  const sinkOf = () => ({
    id: 'sink',
    append: async (records: readonly LedgerRecord[]) => {
      sink.push(...records);
    },
    read: async function* () {
      yield* sink;
    },
  });
  const run = async (
    extra: {
      readonly bumped?: ReadonlySet<string>;
      readonly beforeKeys?: () => Promise<void>;
    } = {},
  ) =>
    replayLedger({
      connected: {
        control: { ledger, epochs: () => epochs },
        keys: { invalidate: () => undefined },
      },
      sources: [source],
      directory: {
        tenant: async (id: string) => {
          if (options.failDirectory === true) throw new Error('the directory is down');
          if (options.backends?.includes(id) === true) return undefined;
          return { id, backendId: 'b1', namespace: { id: 'ns' } };
        },
        backend: async (id: string) =>
          options.backends?.includes(id) === true ? { id, namespace: { id: 'ns' } } : undefined,
      },
      sinks: [sinkOf()],
      records: (await readSinks([sinkOf()])).records,
      bumped: extra.bumped ?? new Set(),
      ...(extra.beforeKeys === undefined ? {} : { beforeKeys: extra.beforeKeys }),
      clock: { now: () => Temporal.Instant.from('2026-11-12T09:00:00Z') },
      log,
    } as never);
  return { control, sink, units, destroyed, logged, warned, order, run };
}

export const tombstonesOf = (records: readonly LedgerRecord[]): string[] =>
  records.flatMap((record) => (record.type === 'keyTombstone' ? [record.keyId] : []));
