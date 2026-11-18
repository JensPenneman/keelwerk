import { describe, expect, test } from 'vitest';
import {
  adaId,
  completed,
  erasureRecord,
  otherTenantId,
  setupReplayLedger,
  ledgerTenantId as tenantId,
  tombstone,
  tombstonesOf,
} from '../../test/replay-ledger-kit.ts';
import type { LedgerRecord } from '../kernel/ledger-record.ts';

describe('the ledger replay at connect', () => {
  test('a boot whose erasures are all complete opens no writing unit', async () => {
    const { run, units, sink } = setupReplayLedger({
      control: [erasureRecord(tenantId, 'c1'), completed(tenantId, 'c1', 0)],
      sink: [erasureRecord(tenantId, 'c1')],
    });
    const { reconciled } = await run();
    expect(units).toEqual([]);
    expect(reconciled.size).toBe(0);
    expect(sink).toHaveLength(1);
  });

  test('an unfinished erasure shreds its keys and appends only the tombstones find lacks', async () => {
    const { run, control, sink } = setupReplayLedger({
      control: [erasureRecord(tenantId, 'c1'), tombstone('k1')],
      sink: [tombstone('k1')],
    });
    await run();
    expect(tombstonesOf(control).sort()).toEqual(['k1', 'k2']);
    expect(tombstonesOf(sink).sort()).toEqual(['k1', 'k2']);
    await run();
    expect(tombstonesOf(control).sort()).toEqual(['k1', 'k2']);
  });

  test('a sink record the control ledger lacks is appended to it and its tenant is reconciled', async () => {
    const { run, control } = setupReplayLedger({
      sink: [erasureRecord(tenantId, 'c1'), tombstone('k0', otherTenantId)],
    });
    const { reconciled } = await run();
    expect(control.map((record) => record.type)).toContain('erasure');
    expect(tombstonesOf(control)).toContain('k0');
    expect([...reconciled].sort()).toEqual([tenantId, otherTenantId].sort());
    // The erasure of the sink is unfinished, so its keys were shredded as well.
    expect(tombstonesOf(control)).toEqual(expect.arrayContaining(['k0', 'k1', 'k2']));
  });

  test('a record the control ledger holds is not copied again, however often the sinks repeat it', async () => {
    const record = erasureRecord(tenantId, 'c1');
    const { run, control } = setupReplayLedger({
      control: [record, completed(tenantId, 'c1', 0)],
      sink: [record, record],
    });
    await run();
    expect(control.filter((entry) => entry.type === 'erasure')).toHaveLength(1);
  });

  test('a sink erasure spelled another way is appended once, in canonical form', async () => {
    const upper = adaId.toUpperCase();
    const compact = adaId.replaceAll('-', '');
    const { run, control } = setupReplayLedger({
      sink: [{ ...erasureRecord(tenantId, 'c1'), subjectId: upper } as LedgerRecord],
    });
    await run();
    const stored = control.filter((entry) => entry.type === 'erasure');
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ subjectId: adaId });
    await run();
    expect(control.filter((entry) => entry.type === 'erasure')).toHaveLength(1);
    // The same erasure spelled without hyphens in a second sink record is the same erasure.
    const second = setupReplayLedger({
      control: [erasureRecord(tenantId, 'c1'), completed(tenantId, 'c1', 0)],
      sink: [{ ...erasureRecord(tenantId, 'c1'), subjectId: compact } as LedgerRecord],
    });
    const { reconciled } = await second.run();
    expect(second.control.filter((entry) => entry.type === 'erasure')).toHaveLength(1);
    expect(reconciled.size).toBe(0);
  });

  test("a bumped tenant's value keys of every tombstone reason are destroyed", async () => {
    const { run, destroyed } = setupReplayLedger({
      control: [
        tombstone('v-erasure', tenantId, 'erasure'),
        tombstone('v-rotation', tenantId, 'rotation'),
        tombstone('v-other', otherTenantId, 'rotation'),
      ],
    });
    await run({ bumped: new Set([tenantId]) });
    expect(destroyed.map((entry) => entry.keyId).sort()).toEqual(['v-erasure', 'v-rotation']);
    expect(destroyed.every((entry) => entry.tenant === tenantId)).toBe(true);
  });

  test('a tenant that is neither bumped nor reconciled has no value key destroyed', async () => {
    const { run, destroyed } = setupReplayLedger({ control: [tombstone('v1')] });
    await run();
    expect(destroyed).toEqual([]);
  });

  test('one failing record is logged with tenant and command id and the rest go on', async () => {
    const { run, control, logged } = setupReplayLedger({
      control: [erasureRecord(tenantId, 'c1'), erasureRecord(otherTenantId, 'c2')],
      failTenant: tenantId,
    });
    await run();
    expect(tombstonesOf(control)).toEqual(['k3']);
    expect(logged).toHaveLength(1);
    expect(logged[0]?.fields).toMatchObject({ tenantId, commandId: 'c1' });
    expect(JSON.stringify(logged[0]?.fields)).not.toContain(adaId);
  });
});
