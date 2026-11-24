import pg from 'pg';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createTestDatabase } from '../support/create-test-database.ts';
import type { TestDatabase } from '../support/test-database.ts';
import { callFlow, openNotes } from './support/concurrency-kit.ts';
import { bootMember, type Member } from './support/lease-member-kit.ts';
import { movableClock } from './support/movable-clock.ts';
import { setFreshLimit } from './support/quota-slice-kit.ts';

// SLICE M2-8 on PostgreSQL, the twin of m2-slice-8-quotas.test.ts, and the counts across processes.
// Two or three runtimes of one deployment (members) share the database and one clock the case
// moves; each has pinned timers, so the passes of its lease keeper run when the case fires them and
// the case awaits the commit of the sweep that ends a pass. No case waits for a time to pass, and
// what a member holds in the store is read from what another member is refused or admitted.

const ten = 10_000;
const minute = 60_000;

let database: TestDatabase;
const clock = movableClock('2026-11-23T08:00:00Z');
const members: Member[] = [];

beforeAll(async () => {
  database = await createTestDatabase('slice_8_quotas');
});
afterAll(async () => {
  await Promise.allSettled(members.splice(0).map((member) => member.runtime.stop(0)));
});

/** Starts a member; the first creates the deployment, the next ones join it. */
async function member(of?: Member): Promise<Member> {
  const made = await bootMember({
    database,
    clock,
    ...(of === undefined ? {} : { join: of.ids() }),
  });
  members.push(made);
  return made;
}

/**
 * Sets a limit through the member, and the clock moves past the refresh bound of its quota cache
 * (`setFreshLimit`): the next request of the member reads the limit as set. The members that start
 * after it read it at their start.
 */
function limit(of: Member, tenant: 'acme' | 'globex', dimension: string, value: string) {
  return setFreshLimit(
    { invoker: of.runtime.invoker, backendId: of.runtime.backendId, step: clock.step },
    of.runtime.tenants[tenant].id,
    dimension,
    value,
  );
}

const add = (of: Member, tenant: 'acme' | 'globex') =>
  callFlow(of.runtime, tenant, 'flow.add', { text: crypto.randomUUID() });

/**
 * A pair of members at a time when every lease of an earlier case has expired. The limits are set
 * through the first member before the second starts, which loads them at its start.
 */
async function pair(limits: readonly (readonly ['acme' | 'globex', string, string])[]) {
  clock.step(minute);
  const a = await member(members[0]);
  for (const [tenant, dimension, value] of limits) {
    expect((await limit(a, tenant, dimension, value)).ok).toBe(true);
  }
  return { a, b: await member(a) };
}

const refusal = {
  ok: false,
  error: { kind: 'rate_limited', code: 'core.concurrency_limited', retryAfter: 1 },
} as const;

describe('the twin of the in-memory slice', () => {
  test('over the rows: core.quota_exceeded; over the request rate: core.rate_limited with retryAfter; the other tenant carries on in both', async () => {
    const a = await member();
    expect((await limit(a, 'globex', 'core.rows', '1')).ok).toBe(true);
    expect((await add(a, 'globex')).ok).toBe(true);
    expect(await add(a, 'globex')).toMatchObject({
      ok: false,
      error: { kind: 'rate_limited', code: 'core.quota_exceeded' },
    });
    expect((await add(a, 'acme')).ok).toBe(true);
    // A process that started after the limits were set holds no tokens of the buckets from before them.
    expect((await limit(a, 'globex', 'core.rows', '1000')).ok).toBe(true);
    expect((await limit(a, 'acme', 'core.requestRate', '2/1h')).ok).toBe(true);
    const b = await member(a);
    expect((await add(b, 'acme')).ok).toBe(true);
    expect((await add(b, 'acme')).ok).toBe(true);
    const refused = await add(b, 'acme');
    expect(refused).toMatchObject({ ok: false, error: { code: 'core.rate_limited' } });
    expect((refused.ok ? 0 : refused.error.retryAfter) ?? 0).toBeGreaterThan(0);
    expect((await add(b, 'globex')).ok).toBe(true);
  });
});

describe('the invocations of a tenant across processes', () => {
  test('one in flight in each process fills the limit; the next of either is refused, the other tenant is served, and the next is admitted when they end', async () => {
    const { a, b } = await pair([
      ['acme', 'core.concurrentInvocations', '2'],
      ['acme', 'core.requestRate', '6000/1m'],
    ]);
    // A call each before the barrier: the process then holds tokens of the rate buckets.
    expect((await add(a, 'acme')).ok).toBe(true);
    expect((await add(b, 'acme')).ok).toBe(true);
    a.arm(a.runtime.tenants.acme.id);
    b.arm(b.runtime.tenants.acme.id);
    const inA = callFlow(a.runtime, 'acme', 'flow.later');
    const inB = callFlow(b.runtime, 'acme', 'flow.later');
    await Promise.all([a.gate.arrived(1), b.gate.arrived(1)]);
    expect(await add(b, 'acme')).toMatchObject(refusal);
    expect(await add(a, 'acme')).toMatchObject(refusal);
    expect((await add(b, 'globex')).ok).toBe(true);
    a.gate.open();
    b.gate.open();
    expect((await Promise.all([inA, inB])).every((outcome) => outcome.ok)).toBe(true);
    expect((await add(b, 'acme')).ok).toBe(true);
  });
});

describe('the subscriptions of a tenant across processes', () => {
  test('one open in each process fills the limit; a slot that ended counts until the next pass of its process, then the other is admitted; one lease holds the open count', async () => {
    const { a, b } = await pair([['acme', 'core.liveSubscriptions', '2']]);
    const inA = await openNotes(a.runtime, 'acme');
    const inB = await openNotes(b.runtime, 'acme');
    expect(inA).toHaveProperty('close');
    expect(inB).toHaveProperty('close');
    expect(await openNotes(b.runtime, 'acme')).toMatchObject({ error: refusal.error });
    expect(await total(a, 'subscriptions')).toBe(2);
    if ('close' in inA) inA.close();
    expect(await openNotes(b.runtime, 'acme')).toMatchObject({ error: refusal.error });
    await a.pass(ten);
    expect(await total(a, 'subscriptions')).toBe(1);
    expect(await openNotes(b.runtime, 'acme')).toHaveProperty('close');
    expect(await total(a, 'subscriptions')).toBe(2);
    expect(await openNotes(b.runtime, 'globex')).toHaveProperty('close');
  });
});

describe('a lowered limit across processes', () => {
  test('binds in both processes: a slot is admitted in the window before the pass of its process, then none while the open ones stand at the limit, and the total of the store comes down as they end', async () => {
    const { a, b } = await pair([['acme', 'core.liveSubscriptions', '3']]);
    const bystander = await openNotes(b.runtime, 'globex');
    expect(bystander).toHaveProperty('close');
    const inA = await openNotes(a.runtime, 'acme');
    const inB = await openNotes(b.runtime, 'acme');
    const moreInB = await openNotes(b.runtime, 'acme');
    for (const stream of [inA, inB, moreInB]) expect(stream).toHaveProperty('close');
    expect(await total(a, 'subscriptions')).toBe(3);
    expect((await limit(a, 'acme', 'core.liveSubscriptions', '1')).ok).toBe(true);
    // A's last answer from the store was a total of 1: its slot that ended is taken again in the window.
    if ('close' in inA) inA.close();
    const window = await openNotes(a.runtime, 'acme');
    expect(window).toHaveProperty('close');
    await a.pass(ten);
    expect(await total(a, 'subscriptions')).toBe(3);
    // After the pass of A: refused, with the two slots of B and the one of A open, nothing closed.
    if ('close' in window) window.close();
    expect(await openNotes(a.runtime, 'acme')).toMatchObject({ error: refusal.error });
    expect(await total(a, 'subscriptions')).toBe(2);
    if ('close' in inB) inB.close();
    expect(await openNotes(b.runtime, 'acme')).toMatchObject({ error: refusal.error });
    await b.pass(ten);
    expect(await total(a, 'subscriptions')).toBe(1);
    expect(await openNotes(a.runtime, 'acme')).toMatchObject({ error: refusal.error });
    if ('close' in moreInB) moreInB.close();
    await b.pass(ten);
    expect(await total(a, 'subscriptions')).toBe(0);
    expect(await openNotes(a.runtime, 'acme')).toHaveProperty('close');
    // The other tenant's stream was open in B throughout and receives what happens to its tenant.
    expect((await add(b, 'globex')).ok).toBe(true);
    if ('next' in bystander) expect(await bystander.next()).toBeDefined();
  });
});

describe('the leases of a process', () => {
  test('a pass renews them: while their holder keeps passing, the other process is refused far past the time to live', async () => {
    const { a, b } = await pair([['acme', 'core.liveSubscriptions', '2']]);
    expect(await openNotes(a.runtime, 'acme')).toHaveProperty('close');
    expect(await openNotes(a.runtime, 'acme')).toHaveProperty('close');
    await a.pass(20_000);
    await a.pass(20_000);
    expect(await openNotes(b.runtime, 'acme')).toMatchObject({ error: refusal.error });
  });

  test('those of a process that stopped expire with their time to live: the other process is refused before and admitted after', async () => {
    const { a, b } = await pair([['acme', 'core.liveSubscriptions', '2']]);
    expect(await openNotes(a.runtime, 'acme')).toHaveProperty('close');
    expect(await openNotes(a.runtime, 'acme')).toHaveProperty('close');
    await a.runtime.stop(0);
    clock.step(29_000);
    expect(await openNotes(b.runtime, 'acme')).toMatchObject({ error: refusal.error });
    clock.step(2_000);
    expect(await openNotes(b.runtime, 'acme')).toHaveProperty('close');
  });

  test('the sweep of a pass deletes the leases of a process that stopped and keeps those of the sweeper', async () => {
    const { a, b } = await pair([['acme', 'core.liveSubscriptions', '5']]);
    // Rows of earlier cases may stay, expired: only what this case adds is counted.
    const before = await expiredRows();
    expect(await openNotes(a.runtime, 'acme')).toHaveProperty('close');
    await a.runtime.stop(0);
    clock.step(31_000);
    expect(await openNotes(b.runtime, 'acme')).toHaveProperty('close');
    // The row of the stopped process is in the table, expired, and the sweeper's row is alive.
    expect(await expiredRows()).toBeGreaterThan(before);
    expect(await liveUnits(b, 'subscriptions')).toEqual([1]);
    await b.pass(ten);
    expect(await expiredRows()).toBe(0);
    expect(await liveUnits(b, 'subscriptions')).toEqual([1]);
  });
});

/** The units of each row of the kind for the tenant `acme` that is alive on the case's clock. */
async function liveUnits(of: Member, kind: 'subscriptions' | 'connections' | 'invocations') {
  const rows = await queryLeases(
    'select units from {table} where kind = $1 and key = $2 and expires_at > $3::timestamptz',
    [kind, of.runtime.tenants.acme.id, clock.clock.now().toString()],
  );
  return rows.map((row) => Number(row.units));
}

/** How many rows of any kind and tenant have expired on the case's clock. */
async function expiredRows(): Promise<number> {
  const rows = await queryLeases(
    'select count(*)::int as n from {table} where expires_at <= $1::timestamptz',
    [clock.clock.now().toString()],
  );
  return Number(rows[0]?.n);
}

/** One query over the table `kw_leases` of the case's database, read as its owner (`{table}` stands for the table). */
async function queryLeases(sql: string, parameters: readonly string[]) {
  const owner = new pg.Client({ connectionString: database.adminUrl });
  await owner.connect();
  try {
    const found = await owner.query(
      "select table_schema from information_schema.tables where table_name = 'kw_leases'",
    );
    const table = `${String(found.rows[0]?.table_schema)}.kw_leases`;
    return (await owner.query(sql.replace('{table}', table), [...parameters])).rows as Record<
      string,
      unknown
    >[];
  } finally {
    await owner.end();
  }
}

/** The units of every unexpired lease of the kind for the tenant `acme`, as the store counts them. */
function total(of: Member, kind: 'subscriptions' | 'connections' | 'invocations') {
  const { adapter, namespace } = of.runtime.control;
  return adapter.unit(
    namespace,
    { level: 'deployment' },
    async (unit) => unit.leases?.total(kind, of.runtime.tenants.acme.id) ?? -1,
    { readOnly: true },
  );
}
