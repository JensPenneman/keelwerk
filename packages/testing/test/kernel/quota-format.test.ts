import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { bootQuotas, setQuota, storedQuota } from './support/quota-kit.ts';

/** A value as JSON text would carry it, the ids the test does not control replaced by `ids`. */
function plain(value: unknown, ids: ReadonlyMap<string, string>): unknown {
  return JSON.parse(
    JSON.stringify(value, (_key, member: unknown) =>
      typeof member === 'string'
        ? [...ids].reduce((text, [id, name]) => text.replaceAll(id, name), member)
        : member,
    ),
  );
}

function golden(name: string, value: unknown): void {
  const path = new URL(`./golden/${name}.json`, import.meta.url);
  expect(value).toEqual(JSON.parse(readFileSync(path, 'utf8')));
}

async function bootFixed() {
  const fixed = Temporal.Instant.from('2026-11-19T08:00:00Z');
  return bootQuotas({ clock: { now: () => fixed } });
}

async function mustSet(runtime: Awaited<ReturnType<typeof bootFixed>>, input: object) {
  const set = await setQuota(runtime, input);
  if (!set.ok) throw set.error;
  return set.value;
}

test('the stored core.quota rows and their created events match their goldens (a bytes row and a rate row, each in its canonical form)', async () => {
  const runtime = await bootFixed();
  const tenant = { backendId: runtime.backendId, tenantId: runtime.tenants.acme.id };
  const bytes = await mustSet(runtime, {
    ...tenant,
    dimension: 'notes.noteBytes',
    limit: '0.5MiB',
    reason: 'a trial tenant',
  });
  const rate = await mustSet(runtime, {
    ...tenant,
    dimension: 'core.requestRate',
    limit: '10/PT1M',
    reason: 'a slow tenant',
  });
  const ids = new Map([
    [bytes.id, '<bytes row id>'],
    [rate.id, '<rate row id>'],
    [runtime.backendId, '<backend id>'],
    [runtime.tenants.acme.id, '<tenant id>'],
  ]);
  const storedBytes = await storedQuota(runtime, bytes.id);
  const storedRate = await storedQuota(runtime, rate.id);
  expect(storedBytes.events).toHaveLength(1);
  expect(storedRate.events).toHaveLength(1);
  golden('quota-rows', {
    bytes: plain(storedBytes.row, ids),
    rate: plain(storedRate.row, ids),
  });
  golden('quota-created-event-data', {
    bytes: plain(storedBytes.events[0]?.data, ids),
    rate: plain(storedRate.events[0]?.data, ids),
  });
});

test('the stored core.quota row and the data of its changed events, after a new limit and after default, match their goldens', async () => {
  const runtime = await bootFixed();
  const base = {
    dimension: 'notes.noteBytes',
    backendId: runtime.backendId,
    tenantId: runtime.tenants.acme.id,
  };
  const first = await mustSet(runtime, { ...base, limit: '1MiB', reason: 'a larger plan' });
  const ids = new Map([
    [first.id, '<row id>'],
    [runtime.backendId, '<backend id>'],
    [runtime.tenants.acme.id, '<tenant id>'],
  ]);
  await mustSet(runtime, { ...base, limit: '512KiB', reason: 'a smaller plan' });
  const afterChange = await storedQuota(runtime, first.id);
  await mustSet(runtime, { ...base, limit: 'default', reason: 'the plan ended' });
  const afterDefault = await storedQuota(runtime, first.id);
  expect(afterChange.events).toHaveLength(2);
  expect(afterDefault.events).toHaveLength(3);
  golden('quota-updated', {
    rowAfterChange: plain(afterChange.row, ids),
    rowAfterDefault: plain(afterDefault.row, ids),
    changeEventData: plain(afterDefault.events[1]?.data, ids),
    defaultEventData: plain(afterDefault.events[2]?.data, ids),
  });
});

test('the canonical grammar of a stored limit is pinned: plain digits for bytes and counts, <count>/<milliseconds>ms for a rate', async () => {
  const runtime = await bootFixed();
  const tenant = { backendId: runtime.backendId, tenantId: runtime.tenants.acme.id };
  const stored: Record<string, unknown> = {};
  for (const [dimension, limit] of [
    ['notes.noteBytes', '1.5KiB'],
    ['notes.noteBytes', '12B'],
    ['core.rows', '007'],
    ['core.rows', '1000'],
    ['core.requestRate', '10/PT1M'],
    ['core.requestRate', '100/1m'],
    ['core.requestRate', '5/250ms'],
    ['core.requestRate', '1/2h'],
  ] as const) {
    const set = await mustSet(runtime, { ...tenant, dimension, limit, reason: 'vector' });
    stored[`${dimension} ${limit}`] = (await storedQuota(runtime, set.id)).row?.limit;
    // Each vector replaces the one before it for the same dimension.
  }
  golden('quota-canonical-limits', stored);
});
