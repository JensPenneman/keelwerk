import { describe, expect, test } from 'vitest';
import { absent } from '../../src/doctor/absent.ts';
import { heldTenantsCheck } from '../../src/doctor/check-held-tenants.ts';
import { controlReaderOf } from '../../src/doctor/control-reader-of.ts';
import { known } from '../../src/doctor/known.ts';
import { runDeploymentChecks } from '../../src/doctor/run-deployment-checks.ts';
import { factsOf } from '../support/facts-of.ts';

const now = Temporal.Instant.from('2026-11-18T10:00:00Z');
const hour = 3_600_000;
const check = (
  tenants: readonly { tenantId: string; unfinishedForMs: number; appliedAgain?: boolean }[],
) =>
  runDeploymentChecks(
    [heldTenantsCheck],
    factsOf({ heldTenants: known(tenants.map((tenant) => ({ appliedAgain: false, ...tenant }))) }),
  );

describe('the held tenants check', () => {
  test('gives one note per tenant with an erasure left to run', async () => {
    const found = check([
      { tenantId: 'tenant-a', unfinishedForMs: 5_000 },
      { tenantId: 'tenant-b', unfinishedForMs: hour },
    ]);
    expect(found.map((finding) => [finding.check, finding.severity, finding.subject])).toEqual([
      ['held-tenants', 'note', 'tenant-a'],
      ['held-tenants', 'note', 'tenant-b'],
    ]);
  });

  test('pins the bound: one hour and a millisecond warns, one hour exactly is a note', () => {
    const found = check([
      { tenantId: 'tenant-a', unfinishedForMs: hour },
      { tenantId: 'tenant-b', unfinishedForMs: hour + 1 },
    ]);
    expect(found.map((finding) => [finding.subject, finding.severity])).toEqual([
      ['tenant-a', 'note'],
      ['tenant-b', 'warning'],
    ]);
  });

  test('the warning says what doctor knows, in minutes under two hours and in hours after', () => {
    const [ninety] = check([{ tenantId: 'tenant-a', unfinishedForMs: 90 * 60_000 }]);
    expect(ninety?.message).toContain('for 90 minutes');
    const [three] = check([{ tenantId: 'tenant-a', unfinishedForMs: 3 * hour + 1 }]);
    expect(three?.message).toBe(
      'no completion of an erasure is recorded for the current epoch of the tenant for 3 hours; its receipt stays accepted and the data it names may still be readable',
    );
  });

  test('an erasure applied again warns past the bound with the wording of what is known, and keeps the note below it', () => {
    const [old, young] = check([
      { tenantId: 'tenant-a', unfinishedForMs: 3 * hour, appliedAgain: true },
      { tenantId: 'tenant-b', unfinishedForMs: hour - 1, appliedAgain: true },
    ]);
    expect(old?.severity).toBe('warning');
    expect(old?.message).toBe(
      'no completion of an erasure is recorded for the current epoch of the tenant; the erasure was recorded 3 hours ago and completed at an earlier epoch, so it is being applied again',
    );
    expect(old?.message).not.toContain('readable');
    expect(old?.message).not.toContain('receipt');
    expect(young?.severity).toBe('note');
  });

  test('gives nothing without an unfinished erasure, and says so when the tenants could not be read', () => {
    expect(check([])).toEqual([]);
    const unread = runDeploymentChecks(
      [heldTenantsCheck],
      factsOf({ heldTenants: absent('the control store could not be read: down', 'start it') }),
    );
    expect(unread.map((finding) => [finding.severity, finding.message])).toEqual([
      ['not-checked', 'the control store could not be read: down'],
    ]);
  });

  test('the reader over the control store lists the tenants of the unfinished erasures, with the epochs of the marks', async () => {
    const asked: ReadonlyMap<string, number>[] = [];
    const record = (tenantId: string, recordedAt: string, rerun = false) => ({
      seq: 1n,
      rerun,
      record: { tenantId, recordedAt },
    });
    const reader = controlReaderOf(
      {
        read: async (fn: (unit: never) => Promise<unknown>) =>
          fn({
            marks: {
              bumped: async () => [
                { scopeId: 'tenant-b', epoch: 2 },
                { scopeId: 'tenant-b', epoch: 3 },
              ],
            },
            ledger: {
              unfinished: async (query: { epochs: ReadonlyMap<string, number> }) => {
                asked.push(query.epochs);
                return {
                  erasures: [
                    record('tenant-b', '2026-11-18T09:00:00Z', true),
                    record('tenant-a', '2026-11-18T09:59:00Z'),
                    record('tenant-b', '2026-11-18T08:00:00Z', true),
                  ],
                };
              },
            },
          } as never),
      } as never,
      () => now,
    );
    expect(await reader.heldTenants()).toEqual([
      { tenantId: 'tenant-a', unfinishedForMs: 60_000, appliedAgain: false },
      { tenantId: 'tenant-b', unfinishedForMs: 2 * hour, appliedAgain: true },
    ]);
    expect(asked[0]?.get('tenant-b')).toBe(3);
    const without = controlReaderOf(
      {
        read: async (fn: (unit: never) => Promise<unknown>) => fn({} as never),
      } as never,
      () => now,
    );
    expect(await without.heldTenants()).toEqual([]);
  });

  test('the reader counts a tenant from its oldest unfinished record', async () => {
    const record = (recordedAt: string) => ({
      seq: 1n,
      record: { tenantId: 'tenant-c', recordedAt },
    });
    const reader = controlReaderOf(
      {
        read: async (fn: (unit: never) => Promise<unknown>) =>
          fn({
            marks: { bumped: async () => [] },
            ledger: {
              unfinished: async () => ({
                erasures: [record('2026-11-18T09:00:00Z'), record('2026-11-18T08:00:00Z')],
              }),
            },
          } as never),
      } as never,
      () => now,
    );
    expect(await reader.heldTenants()).toEqual([
      { tenantId: 'tenant-c', unfinishedForMs: 2 * hour, appliedAgain: false },
    ]);
  });

  test('a tenant restored long ago with a new unfinished erasure gets the ordinary line, a record completed at an earlier epoch the applied-again line', async () => {
    const heldOf = async (records: readonly { recordedAt: string; rerun: boolean }[]) => {
      const reader = controlReaderOf(
        {
          read: async (fn: (unit: never) => Promise<unknown>) =>
            fn({
              marks: { bumped: async () => [{ scopeId: 'tenant-a', epoch: 1 }] },
              ledger: {
                unfinished: async () => ({
                  erasures: records.map((one, index) => ({
                    seq: BigInt(index + 1),
                    rerun: one.rerun,
                    record: { tenantId: 'tenant-a', recordedAt: one.recordedAt },
                  })),
                }),
              },
            } as never),
        } as never,
        () => now,
      );
      return runDeploymentChecks(
        [heldTenantsCheck],
        factsOf({ heldTenants: known(await reader.heldTenants()) }),
      );
    };
    const [recent] = await heldOf([{ recordedAt: '2026-11-18T09:30:00Z', rerun: false }]);
    expect(recent?.severity).toBe('note');
    const [stuck] = await heldOf([{ recordedAt: '2026-11-18T07:00:00Z', rerun: false }]);
    expect(stuck?.severity).toBe('warning');
    expect(stuck?.message).toBe(
      'no completion of an erasure is recorded for the current epoch of the tenant for 3 hours; its receipt stays accepted and the data it names may still be readable',
    );
    const [again] = await heldOf([{ recordedAt: '2026-11-18T07:00:00Z', rerun: true }]);
    expect(again?.severity).toBe('warning');
    expect(again?.message).toContain('completed at an earlier epoch, so it is being applied again');
    const [mixed] = await heldOf([
      { recordedAt: '2026-11-18T05:00:00Z', rerun: true },
      { recordedAt: '2026-11-18T07:00:00Z', rerun: false },
    ]);
    expect(mixed?.message).toContain('for 3 hours; its receipt stays accepted');
  });
});
