import { afterAll, beforeAll, expect, test } from 'vitest';
import { createTestDatabase } from '../support/create-test-database.ts';
import type { TestDatabase } from '../support/test-database.ts';
import { openNotes } from './support/concurrency-kit.ts';
import { bootMember, type Member } from './support/lease-member-kit.ts';
import { movableClock } from './support/movable-clock.ts';
import { setFreshLimit } from './support/quota-slice-kit.ts';

// Three processes (members) of one deployment on one database, the limit of open subscriptions of
// a tenant going 6, 2, 1, each take, close and pass decided by a seed. The clock is the case's and
// moves only when the case moves it, so no time decides a verdict; every step ends when its work
// has ended. After a lowering has reached every process (the quota caches read it, every keeper has
// passed once) no take is admitted while the open slots stand at or over the limit; at the end
// every slot is closed and the store counts none.

const ten = 10_000;
const limits = [6, 2, 1] as const;

let database: TestDatabase;
const clock = movableClock('2026-11-24T08:00:00Z');
const members: Member[] = [];

beforeAll(async () => {
  database = await createTestDatabase('lowered_limit_churn');
});
afterAll(async () => {
  await Promise.allSettled(members.splice(0).map((member) => member.runtime.stop(0)));
});

function generator(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

function setLimit(of: Member, value: number) {
  return setFreshLimit(
    { invoker: of.runtime.invoker, backendId: of.runtime.backendId, step: clock.step },
    of.runtime.tenants.acme.id,
    'core.liveSubscriptions',
    String(value),
  );
}

/** The units of every unexpired lease of the tenant `acme`, as the store counts them. */
function stored(of: Member) {
  const { adapter, namespace } = of.runtime.control;
  return adapter.unit(
    namespace,
    { level: 'deployment' },
    async (unit) => unit.leases?.total('subscriptions', of.runtime.tenants.acme.id) ?? -1,
    { readOnly: true },
  );
}

/** Every keeper passes once, at the same moment of the shared clock. */
async function round(all: readonly Member[]) {
  for (const [index, one] of all.entries()) await one.pass(index === 0 ? ten : 0);
}

test('a lowered limit binds in every process on PostgreSQL once the lowering has reached it, and the store ends at zero', async () => {
  let admitted = 0;
  let refused = 0;
  clock.step(60_000);
  const first = await bootMember({ database, clock });
  members.push(first);
  const all = [first];
  for (let index = 1; index < 3; index += 1) {
    const joined = await bootMember({ database, clock, join: first.ids() });
    members.push(joined);
    all.push(joined);
  }
  for (const seed of [11, 12, 13]) {
    // The limit is raised again at the start of each seed: the next seed starts with nothing open.
    expect((await setLimit(first, limits[0])).ok).toBe(true);
    await round(all);
    const random = generator(seed);
    const open: { readonly close: () => void; readonly next: () => Promise<unknown> }[] = [];
    for (const [phase, limit] of limits.entries()) {
      if (phase > 0) {
        expect((await setLimit(first, limit)).ok).toBe(true);
        await round(all);
      }
      for (let step = 0; step < 50; step += 1) {
        const draw = random();
        const one = all[Math.floor(random() * all.length)];
        if (one === undefined) continue;
        if (draw < 0.55) {
          const opened = await openNotes(one.runtime, 'acme');
          if ('close' in opened) {
            // After the first lowering a slot may be admitted only while the open ones are below the limit.
            if (phase > 0) {
              admitted += 1;
              expect(open.length).toBeLessThan(limit);
            }
            open.push(opened);
          } else {
            expect(opened).toMatchObject({ error: { code: 'core.concurrency_limited' } });
            refused += 1;
          }
        } else if (draw < 0.9) {
          const [gone] = open.splice(Math.floor(random() * open.length), 1);
          gone?.close();
          while ((await gone?.next()) !== undefined);
        } else await round(all);
      }
    }
    for (const gone of open.splice(0)) {
      gone.close();
      while ((await gone.next()) !== undefined);
    }
    await round(all);
    expect(await stored(first)).toBe(0);
  }
  expect(admitted).toBeGreaterThan(0);
  expect(refused).toBeGreaterThan(0);
});
