import { describe, expect, test } from 'vitest';
import { hybridClock } from '../clock/hybrid-clock.ts';
import type { StreamAppend } from '../events/stream-append.ts';
import type { Registry } from '../registry/registry.ts';
import type { Unit } from '../storage/unit.ts';
import { appendReceiptChange } from './append-receipt-change.ts';
import { commandReceiptUuid } from './command-receipt-uuid.ts';

const now = Temporal.Instant.from('2026-01-01T00:00:00Z');

const registry = {
  entities: new Map([['core.commandReceipt', { descriptor: { shape: { id: 'shape-1' } } }]]),
} as unknown as Registry;

/** A unit whose stream already holds `stored` events, and which keeps what is appended. */
function unitOf(stored: number): { readonly unit: Unit; readonly appended: StreamAppend[] } {
  const appended: StreamAppend[] = [];
  const unit = {
    events: {
      readStream: async () => Array.from({ length: stored }, (_, i) => ({ version: i + 1 })),
      append: async (batch: readonly StreamAppend[]) => {
        appended.push(...batch);
        return [];
      },
    },
  } as unknown as Unit;
  return { unit, appended };
}

const change = (
  status: 'accepted' | 'completed',
  scope: Parameters<typeof appendReceiptChange>[1]['scope'],
) => ({
  registry,
  scope,
  receipt: {
    commandId: 'c1',
    action: 'loans.closeAll',
    status,
    outcome: status === 'completed' ? ({ ok: true, value: {}, effects: [] } as const) : null,
    apiVersion: '2026-11-04',
    principalResolver: null,
    principalId: null,
    clientId: null,
    clientSeq: null,
    expiresAt: now,
  },
  meta: {
    actor: { kind: 'operator' as const, id: 'olive', via: 'core.operator' },
    commandId: 'c1',
    action: 'loans.closeAll',
    causationId: null,
    correlationId: 'r',
    client: null,
    merge: null,
    traceparent: null,
    writer: { build: 'b', revision: 1 },
    flags: [],
    decision: null,
  },
  hybridClock: hybridClock('node'),
  now,
});

describe('appendReceiptChange', () => {
  test('a deployment-scope receipt writes nothing', async () => {
    const { unit, appended } = unitOf(0);
    await appendReceiptChange(unit, change('accepted', { level: 'deployment' }));
    expect(appended).toEqual([]);
  });

  test('the record rides the receipt stream at the stream version, not at the row version', async () => {
    const tenant = { level: 'tenant', backendId: 'b-1', tenantId: 't-1' } as const;
    const first = unitOf(0);
    await appendReceiptChange(first.unit, change('accepted', tenant));
    const [created] = first.appended;
    expect(created?.expectedVersion).toBe(0);
    expect(created?.stream).toEqual({
      type: 'core.commandReceipt',
      id: commandReceiptUuid('t-1', 'c1'),
    });
    expect(created?.events[0]).toMatchObject({
      name: 'created',
      transient: true,
      hash: null,
      prevHash: null,
      schemaVersion: 1,
      shape: 'shape-1',
    });
    const later = unitOf(2);
    await appendReceiptChange(later.unit, change('accepted', tenant));
    expect(later.appended[0]?.expectedVersion).toBe(2);
    const done = unitOf(1);
    await appendReceiptChange(
      done.unit,
      change('completed', { level: 'backend', backendId: 'b-1' }),
    );
    expect(done.appended[0]?.stream.id).toBe(commandReceiptUuid('b-1', 'c1'));
    expect(done.appended[0]?.events[0]).toMatchObject({ name: 'changed' });
  });
});
