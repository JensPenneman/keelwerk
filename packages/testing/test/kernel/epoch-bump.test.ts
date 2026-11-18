import { describe, expect, test } from 'vitest';
import { useEpochKit } from './support/epoch-kit.ts';

const { directories, boot, stop, addBook, stateOf, changesSince, bumpedMarks, headOf, bumps } =
  useEpochKit();
const { backUp, restore } = directories;

describe('restore detection at connect (14.7.6), PGlite on directories', () => {
  test('a first boot records identities and marks without bumping; two boots without a restore bump nothing', {
    timeout: 120_000,
  }, async () => {
    const first = await boot();
    await addBook(first.runtime, '1');
    const identities = await first.runtime.control.adapter.unit(
      first.runtime.control.namespace,
      { level: 'deployment' },
      async (unit) => unit.identities?.all() ?? [],
      { readOnly: true },
    );
    // The control namespace and the app's namespace each have an identity.
    expect(identities.length).toBeGreaterThanOrEqual(2);
    expect(bumps(first)).toEqual([]);
    const ids = first.ids;
    await stop(first);

    const second = await boot(ids);
    expect(bumps(second)).toEqual([]);
    expect(await bumpedMarks(second.runtime)).toEqual([]);
    await addBook(second.runtime, '2');
    await stop(second);

    const third = await boot(ids);
    expect(bumps(third)).toEqual([]);
    expect(await bumpedMarks(third.runtime)).toEqual([]);
  });

  test('a restored directory is detected at the next start: the epoch moves, an old token resets and no position is reused', {
    timeout: 180_000,
  }, async () => {
    const first = await boot();
    await addBook(first.runtime, '1');
    const { ids } = first;
    await stop(first);
    // The backup: the placement's directory as it stands now.
    await backUp();

    const second = await boot(ids);
    expect(bumps(second)).toEqual([]);
    await addBook(second.runtime, '2');
    await addBook(second.runtime, '3');
    const token = await stateOf(second.runtime);
    expect(token).toMatch(/^v2\.0\./);
    const before = await headOf(second.runtime);
    await stop(second);

    // The restore: the placement goes back to the backup, the control store keeps its marks.
    await restore();
    const third = await boot(ids);
    const found = bumps(third);
    expect(found.length).toBeGreaterThan(0);
    expect(found.map((entry) => entry.fields.reason)).toContain('counter');
    expect(found.every((entry) => entry.fields.to === 2 && entry.fields.from === 0)).toBe(true);
    const tenantMark = (await bumpedMarks(third.runtime)).find(
      (mark) => mark.scopeId === third.runtime.tenants.acme.id,
    );
    expect(tenantMark?.epoch).toBe(2);
    // A token issued before the restore answers reset; one issued after it is accepted.
    expect(await changesSince(third.runtime, token)).toMatchObject({
      cannotCalculateChanges: true,
      reason: 'epoch',
    });
    const fresh = await stateOf(third.runtime);
    expect(fresh).toMatch(/^v2\.2\./);
    expect(await changesSince(third.runtime, fresh)).toMatchObject({ hasMoreChanges: false });
    // The counters moved past the mark: what the restored directory lacks is not handed out again.
    await addBook(third.runtime, '4');
    expect(await headOf(third.runtime)).toBeGreaterThan(before);
    await stop(third);

    // The bump is stable: a later start without a restore bumps nothing more.
    const fourth = await boot(ids);
    expect(bumps(fourth)).toEqual([]);
  });

  test('a new timeline bumps every scope of the namespace', { timeout: 120_000 }, async () => {
    const first = await boot();
    await addBook(first.runtime, '1');
    const { ids } = first;
    await stop(first);
    const recovered = await boot(ids, (identity) => ({
      ...identity,
      timeline: `${identity.timeline}-pitr`,
    }));
    const found = bumps(recovered);
    expect(found.length).toBeGreaterThan(0);
    expect(new Set(found.map((entry) => entry.fields.reason))).toEqual(new Set(['timeline']));
  });

  test('another cluster (a changed system id) bumps with the reason identity', {
    timeout: 120_000,
  }, async () => {
    const first = await boot();
    await addBook(first.runtime, '1');
    const { ids } = first;
    await stop(first);
    const moved = await boot(ids, (identity) => ({
      ...identity,
      systemId: `${identity.systemId}9`,
    }));
    expect(new Set(bumps(moved).map((entry) => entry.fields.reason))).toEqual(
      new Set(['identity']),
    );
  });

  test('a mark of a scope the directory does not know is left alone: nothing bumps, no row is made, the mark stays', {
    timeout: 120_000,
  }, async () => {
    const first = await boot();
    await addBook(first.runtime, '1');
    const { ids } = first;
    const namespaceId = first.runtime.namespace.id;
    const strayId = crypto.randomUUID();
    // A purged or moved scope: its mark is in the control store, its counters are not here.
    await first.runtime.control.adapter.unit(
      first.runtime.control.namespace,
      { level: 'deployment' },
      async (unit) =>
        unit.marks?.raise([
          {
            scopeId: strayId,
            namespaceId,
            epoch: 0,
            position: 7n,
            serials: {},
            updatedAt: Temporal.Instant.from('2026-11-18T10:00:00Z'),
          },
        ]),
    );
    await stop(first);

    const second = await boot(ids);
    expect(bumps(second)).toEqual([]);
    expect(second.warnings.filter((entry) => entry.message.includes('restore'))).toEqual([]);
    const rows = await second.runtime.adapter.unit(
      second.runtime.namespace,
      { level: 'namespace', reason: 'test' },
      async (unit) => unit.counters?.list({ limit: 100, scopeIds: [strayId] }) ?? [],
      { readOnly: true },
    );
    expect(rows).toEqual([]);
    const marks = await second.runtime.control.adapter.unit(
      second.runtime.control.namespace,
      { level: 'deployment' },
      async (unit) => unit.marks?.list(namespaceId, { limit: 100 }) ?? [],
      { readOnly: true },
    );
    expect(marks.find((mark) => mark.scopeId === strayId)).toMatchObject({
      epoch: 0,
      position: 7n,
    });
  });

  test('a rewind recorded under a running process still bumps at the next start when the counters climbed back above the mark', {
    timeout: 120_000,
  }, async () => {
    const first = await boot();
    await addBook(first.runtime, '1');
    await addBook(first.runtime, '2');
    const { ids } = first;
    const tenantId = first.runtime.tenants.acme.id;
    // What the minute loop leaves when it finds a rewind: the tenant's mark at a new epoch, with
    // a position below where the counters have since climbed (other processes kept writing).
    const moved = await first.runtime.control.adapter.unit(
      first.runtime.control.namespace,
      { level: 'deployment' },
      async (unit) =>
        unit.marks?.bump(
          {
            scopeId: tenantId,
            namespaceId: first.runtime.namespace.id,
            epoch: 2,
            position: 1n,
            serials: {},
            updatedAt: Temporal.Instant.from('2026-11-18T10:00:00Z'),
          },
          0,
        ),
    );
    expect(moved).toBe(2);
    await stop(first);

    const second = await boot(ids);
    const found = bumps(second).filter((entry) => entry.fields.scope === tenantId);
    expect(found).toHaveLength(1);
    expect(found[0]?.fields).toMatchObject({ reason: 'counter', from: 2, to: 3 });
    const mark = (await bumpedMarks(second.runtime)).find((entry) => entry.scopeId === tenantId);
    expect(mark?.epoch).toBe(3);
    expect(await stateOf(second.runtime)).toMatch(/^v2\.3\./);
    await stop(second);

    // Stable afterwards: the counters moved to the new epoch.
    const third = await boot(ids);
    expect(bumps(third)).toEqual([]);
  });
});
