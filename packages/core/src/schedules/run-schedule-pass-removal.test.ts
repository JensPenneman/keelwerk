import { expect, test, vi } from 'vitest';
import { makePassWorld } from '../../test/support/make-pass-world.ts';
import { defaultScheduleLimits } from './default-schedule-limits.ts';

vi.mock('../effects/seal-job-input.ts', () => ({
  sealJobInput: async (_unit: unknown, _id: string, _action: unknown, input: unknown) => input,
}));

const T0 = Temporal.Instant.from('2026-01-01T00:05:00Z');
const ref = 'ticker.everyTenant';
const row = (scopeId: string, scheduleId = ref) => ({ scopeId, scheduleId, nextTick: T0 });

test('a row of a tenant that no longer exists is deleted, and the live tenant still ticks', async () => {
  const w = makePassWorld({ one: ['a1'] });
  w.rows.set(`a1\u0000${ref}`, row('a1'));
  w.rows.set(`ghost\u0000${ref}`, row('ghost'));
  w.state.seeded.add(`${ref}\u0000ghost`);
  await w.pass();
  await w.settle();
  expect(w.jobs.map((job) => job.scope.level === 'tenant' && job.scope.tenantId)).toEqual(['a1']);
  expect(w.rows.has(`ghost\u0000${ref}`)).toBe(false);
  expect(w.removed).toEqual([`ghost\u0000${ref}`]);
  // The seed is forgotten, so a scope wrongly reported gone is seeded again by the next fan-out.
  expect(w.state.seeded.has(`${ref}\u0000ghost`)).toBe(false);
  // Nothing is claimed again and again: the next pass finds nothing for it.
  await w.pass();
  expect(w.removed).toHaveLength(1);
});

test('a row of a tenant whose backend no longer exists is deleted', async () => {
  const w = makePassWorld({ one: ['a1'], two: ['b1'] });
  w.rows.set(`b1\u0000${ref}`, row('b1'));
  w.backends.delete('two');
  await w.pass();
  await w.settle();
  expect(w.jobs).toHaveLength(0);
  expect(w.rows.has(`b1\u0000${ref}`)).toBe(false);
});

test('a row of a backend schedule whose backend no longer exists is deleted', async () => {
  const w = makePassWorld({ one: ['a1'] }, { scope: 'backend' });
  w.rows.set(`one\u0000${ref}`, row('one'));
  w.rows.set(`old\u0000${ref}`, row('old'));
  await w.pass();
  await w.settle();
  expect(w.removed).toEqual([`old\u0000${ref}`]);
  expect(w.rows.has(`one\u0000${ref}`)).toBe(true);
});

test('a row whose id belongs to the other level is kept, claimed staleMs ahead: another build changed the scope', async () => {
  const ahead = T0.add({ milliseconds: defaultScheduleLimits.staleMs }).toString();
  const backendEntry = makePassWorld({ one: ['a1'] }, { scope: 'backend' });
  backendEntry.rows.set(`a1\u0000${ref}`, row('a1'));
  await backendEntry.pass();
  await backendEntry.settle();
  expect(backendEntry.rows.get(`a1\u0000${ref}`)?.nextTick.toString()).toBe(ahead);
  expect(backendEntry.removed).toEqual([]);
  const tenantEntry = makePassWorld({ one: ['a1'] });
  tenantEntry.rows.set(`one\u0000${ref}`, row('one'));
  await tenantEntry.pass();
  await tenantEntry.settle();
  expect(tenantEntry.rows.get(`one\u0000${ref}`)?.nextTick.toString()).toBe(ahead);
  expect(tenantEntry.removed).toEqual([]);
});

test('a row of a schedule this build does not know is kept, claimed staleMs ahead', async () => {
  const w = makePassWorld({ one: ['a1'] });
  w.rows.set('a1\u0000ticker.newer', row('a1', 'ticker.newer'));
  w.rows.set('ghost\u0000ticker.newer', row('ghost', 'ticker.newer'));
  await w.pass();
  await w.settle();
  const ahead = T0.add({ milliseconds: defaultScheduleLimits.staleMs }).toString();
  expect(w.rows.get('a1\u0000ticker.newer')?.nextTick.toString()).toBe(ahead);
  expect(w.rows.get('ghost\u0000ticker.newer')?.nextTick.toString()).toBe(ahead);
  expect(w.removed).toEqual([]);
});

test('a deletion that fails holds the row for a while and is tried again after', async () => {
  const w = makePassWorld({ one: ['a1'] });
  w.rows.set(`ghost\u0000${ref}`, row('ghost'));
  w.failing.claims = true;
  await w.pass();
  expect(w.rows.has(`ghost\u0000${ref}`)).toBe(true);
  expect(w.state.held.has(`${ref}\u0000ghost`)).toBe(true);
  w.failing.claims = false;
  w.clock.now = T0.add({ milliseconds: defaultScheduleLimits.retryMs });
  await w.pass();
  expect(w.rows.has(`ghost\u0000${ref}`)).toBe(false);
});
