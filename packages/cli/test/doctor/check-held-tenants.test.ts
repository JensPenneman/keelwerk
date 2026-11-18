import { describe, expect, test } from 'vitest';
import { checkHeldTenants } from '../../src/doctor/check-held-tenants.ts';
import type { ControlReader } from '../../src/doctor/control-reader.ts';
import { controlReaderOf } from '../../src/doctor/control-reader-of.ts';
import type { DeploymentFacts } from '../../src/doctor/deployment-facts.ts';
import type { DeploymentInput } from '../../src/doctor/deployment-input.ts';

const now = Temporal.Instant.from('2026-11-18T10:00:00Z');
const facts = {} as DeploymentFacts;
const inputOf = (reader: Partial<ControlReader> | undefined): DeploymentInput =>
  ({ reader }) as unknown as DeploymentInput;

describe('the held tenants check', () => {
  test('gives one note per tenant with an erasure left to run', async () => {
    const found = await checkHeldTenants(
      inputOf({ heldTenants: async () => ['tenant-a', 'tenant-b'] }),
      facts,
      now,
    );
    expect(found.map((finding) => [finding.check, finding.severity, finding.subject])).toEqual([
      ['held-tenants', 'note', 'tenant-a'],
      ['held-tenants', 'note', 'tenant-b'],
    ]);
  });

  test('gives nothing without a reader, a list or an unfinished erasure', async () => {
    expect(await checkHeldTenants(inputOf(undefined), facts, now)).toEqual([]);
    expect(await checkHeldTenants(inputOf({}), facts, now)).toEqual([]);
    expect(await checkHeldTenants(inputOf({ heldTenants: async () => [] }), facts, now)).toEqual(
      [],
    );
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
    expect(await reader.heldTenants?.()).toEqual(['tenant-a', 'tenant-b']);
    expect(asked[0]?.get('tenant-b')).toBe(3);
    const without = controlReaderOf(
      {
        read: async (fn: (unit: never) => Promise<unknown>) => fn({} as never),
        entity: () => undefined as never,
      } as never,
      () => now,
    );
    expect(await without.heldTenants?.()).toEqual([]);
  });
});
