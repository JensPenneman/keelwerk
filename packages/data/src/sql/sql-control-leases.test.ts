import type { ControlLease } from '@keelwerk/core';
import { describe, expect, test, vi } from 'vitest';
import { dummyDb } from '../../test/support/dummy-db.ts';
import { fixedInstant } from '../../test/support/fixed-instant.ts';
import { namespaceRef } from '../../test/support/namespace-ref.ts';
import { testClock } from '../../test/support/test-clock.ts';
import { sqlControlLeases } from './sql-control-leases.ts';
import { sqlEntityIndex } from './sql-entity-index.ts';
import { sqlUnitContext } from './sql-unit-context.ts';

function leasesOn() {
  const db = dummyDb();
  const executed = vi.spyOn(db, 'executeQuery');
  const leases = sqlControlLeases(
    sqlUnitContext({
      namespace: namespaceRef,
      scope: { level: 'deployment' },
      readOnly: false,
      deploymentId: '00000000-0000-4000-8000-0000000000d1',
      clock: testClock(fixedInstant),
      keyWrapper: undefined,
      entities: sqlEntityIndex(),
      db,
    }),
  );
  return { leases, executed };
}

const lease: Omit<ControlLease, 'expiresAt'> = {
  kind: 'topic',
  scopeId: null,
  key: 'k',
  holder: 'p1',
  units: 1,
};

describe('hold serialises per kind and key', () => {
  test("the advisory lock text is 'keelwerk:lease:<kind>:<key>', the text processes of every version share", async () => {
    const { leases, executed } = leasesOn();
    await leases.hold({ ...lease, kind: 'connections', key: '["s","a.b",{"p":1}]' }, 5_000);
    const [first] = executed.mock.calls;
    expect(first?.[0]).toMatchObject({
      sql: 'select pg_advisory_xact_lock(hashtextextended($1, 0))',
      parameters: ['keelwerk:lease:connections:["s","a.b",{"p":1}]'],
    });
  });
});

describe('a lease key or holder is well-formed text', () => {
  test('a lone surrogate is validation on hold, release and total, and nothing is run', async () => {
    const { leases, executed } = leasesOn();
    const refused = async (work: Promise<unknown>) => {
      await expect(work).rejects.toMatchObject({ kind: 'validation', code: 'core.validation' });
    };
    await refused(leases.hold({ ...lease, key: 'k\uD800' }, 5_000));
    await refused(leases.hold({ ...lease, holder: 'p\uDBFF' }, 5_000));
    await refused(leases.release('topic', 'k\uD800', 'p1'));
    await refused(leases.total('topic', 'k\uDC00'));
    expect(executed).not.toHaveBeenCalled();
  });

  test('a surrogate pair is accepted', async () => {
    const { leases } = leasesOn();
    await expect(leases.hold({ ...lease, key: 'k\u{1F600}' }, 5_000)).resolves.toEqual({
      total: 0,
    });
  });
});
