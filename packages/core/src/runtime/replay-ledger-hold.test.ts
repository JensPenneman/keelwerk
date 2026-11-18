import { describe, expect, test } from 'vitest';
import {
  completed,
  erasureRecord,
  otherTenantId,
  setupReplayLedger,
  ledgerTenantId as tenantId,
  tombstone,
  tombstonesOf,
} from '../../test/replay-ledger-kit.ts';

describe('the hold and the failures of the ledger replay at connect', () => {
  test('every tenant with an unfinished erasure is held, whichever way its record came', async () => {
    // A record in the control ledger and in a sink, not rerun: the view of a process that starts
    // after the one that copied it.
    const both = setupReplayLedger({
      control: [erasureRecord(tenantId, 'c1')],
      sink: [erasureRecord(tenantId, 'c1')],
    });
    expect([...(await both.run()).held]).toEqual([tenantId]);
    // A record in the control ledger only is held as well: the hold derives from the ledger.
    const plain = setupReplayLedger({ control: [erasureRecord(tenantId, 'c1')] });
    expect([...(await plain.run()).held]).toEqual([tenantId]);
    // A record only a sink holds is copied, and held.
    const reconciled = setupReplayLedger({ sink: [erasureRecord(tenantId, 'c1')] });
    expect([...(await reconciled.run()).held]).toEqual([tenantId]);
    // A rerun is held too, and a record completed at the current epoch is not.
    const rerun = setupReplayLedger({ control: [erasureRecord(tenantId, 'c1')], rerun: true });
    expect([...(await rerun.run()).held]).toEqual([tenantId]);
    const done = setupReplayLedger({
      control: [erasureRecord(tenantId, 'c1'), completed(tenantId, 'c1', 0)],
      sink: [erasureRecord(tenantId, 'c1')],
      rerun: true,
    });
    expect((await done.run()).held.size).toBe(0);
  });

  test('a second run over the same ledger holds the tenant again, and each held tenant is warned once', async () => {
    const kit = setupReplayLedger({
      control: [
        erasureRecord(tenantId, 'c1'),
        erasureRecord(tenantId, 'c2'),
        erasureRecord(otherTenantId, 'c3'),
      ],
    });
    expect([...(await kit.run()).held].sort()).toEqual([tenantId, otherTenantId].sort());
    expect([...(await kit.run()).held].sort()).toEqual([tenantId, otherTenantId].sort());
    const first = kit.warned.slice(0, 2);
    expect(first.map((entry) => entry.message)).toEqual([
      'a tenant is held until its erasures have run again',
      'a tenant is held until its erasures have run again',
    ]);
    expect(
      first
        .map((entry) => entry.fields)
        .sort((a, b) => String(a.tenantId).localeCompare(String(b.tenantId))),
    ).toEqual([{ tenantId }, { tenantId: otherTenantId }]);
    expect(kit.warned).toHaveLength(4);
  });

  test('a probe or an append of step (b) that fails fails the replay', async () => {
    const probe = setupReplayLedger({ sink: [erasureRecord(tenantId, 'c1')], failFind: true });
    await expect(probe.run()).rejects.toThrow('the ledger is down');
    const append = setupReplayLedger({ sink: [erasureRecord(tenantId, 'c1')], failAppend: true });
    await expect(append.run()).rejects.toThrow('the ledger is down');
    expect(append.control).toEqual([]);
  });

  test('a value key that cannot be destroyed fails the replay, so the restore is found again', async () => {
    const kit = setupReplayLedger({ control: [tombstone('v1')], failDestroy: true });
    await expect(kit.run({ bumped: new Set([tenantId]) })).rejects.toThrow('the key store is down');
  });

  test('the value keys of a sink tombstone are destroyed before the tombstone is appended', async () => {
    const kit = setupReplayLedger({ sink: [tombstone('v1', tenantId, 'rotation')] });
    await kit.run();
    expect(kit.destroyed).toEqual([{ tenant: tenantId, keyId: 'v1' }]);
    expect(kit.order.filter((step) => step !== 'unfinished')).toEqual(['destroy', 'append']);
    expect(tombstonesOf(kit.control)).toEqual(['v1']);
  });

  test('a destroy that fails leaves the sink records missing, so the next start reconciles them again', async () => {
    const kit = setupReplayLedger({
      sink: [tombstone('v1', tenantId, 'rotation'), erasureRecord(tenantId, 'c1')],
      failDestroy: true,
    });
    await expect(kit.run()).rejects.toThrow('the key store is down');
    expect(kit.control).toEqual([]);
    expect(kit.order).not.toContain('append');
  });

  test('a tenant lookup that fails in step (d) fails the replay', async () => {
    const kit = setupReplayLedger({ control: [tombstone('v1')], failDirectory: true });
    await expect(kit.run({ bumped: new Set([tenantId]) })).rejects.toThrow('the directory is down');
    expect(kit.destroyed).toEqual([]);
  });

  test('beforeKeys runs after the value keys and before the keys of the unfinished erasures', async () => {
    const kit = setupReplayLedger({
      control: [erasureRecord(tenantId, 'c1'), tombstone('v1', tenantId, 'rotation')],
    });
    await kit.run({
      bumped: new Set([tenantId]),
      beforeKeys: async () => {
        kit.order.push('before');
      },
    });
    expect(kit.order.filter((step) => step !== 'append')).toEqual([
      'destroy',
      'before',
      'unfinished',
    ]);
  });
});
