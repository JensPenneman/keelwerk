import { describe, expect, test } from 'vitest';
import { absent } from '../../src/doctor/absent.ts';
import { heldTenantsCheck } from '../../src/doctor/check-held-tenants.ts';
import { controlReaderOf } from '../../src/doctor/control-reader-of.ts';
import { known } from '../../src/doctor/known.ts';
import { runDeploymentChecks } from '../../src/doctor/run-deployment-checks.ts';
import { factsOf } from '../support/facts-of.ts';

const now = Temporal.Instant.from('2026-11-18T10:00:00Z');
const check = (tenants: readonly string[]) =>
  runDeploymentChecks([heldTenantsCheck], factsOf({ heldTenants: known(tenants) }));

describe('the held tenants check', () => {
  test('gives one note per tenant with an erasure left to run', async () => {
    const found = check(['tenant-a', 'tenant-b']);
    expect(found.map((finding) => [finding.check, finding.severity, finding.subject])).toEqual([
      ['held-tenants', 'note', 'tenant-a'],
      ['held-tenants', 'note', 'tenant-b'],
    ]);
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
    const record = (tenantId: string) => ({ seq: 1n, record: { tenantId } });
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
                return { erasures: [record('tenant-b'), record('tenant-a'), record('tenant-b')] };
              },
            },
          } as never),
        entity: () => undefined as never,
      } as never,
      () => now,
    );
    expect(await reader.heldTenants()).toEqual(['tenant-a', 'tenant-b']);
    expect(asked[0]?.get('tenant-b')).toBe(3);
    const without = controlReaderOf(
      {
        read: async (fn: (unit: never) => Promise<unknown>) => fn({} as never),
        entity: () => undefined as never,
      } as never,
      () => now,
    );
    expect(await without.heldTenants()).toEqual([]);
  });
});
