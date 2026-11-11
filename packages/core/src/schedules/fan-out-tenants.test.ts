import { expect, test, vi } from 'vitest';
import { makePassWorld } from '../../test/support/make-pass-world.ts';
import { fanOutTenants } from './fan-out-tenants.ts';

vi.mock('../effects/seal-job-input.ts', () => ({
  sealJobInput: async (_unit: unknown, _id: string, _action: unknown, input: unknown) => input,
}));

async function scopesOf(w: ReturnType<typeof makePassWorld>, pageSize: number) {
  const entry = w.source.registry.schedules.values().next().value;
  if (entry === undefined) throw new Error('no schedule');
  const found: { tenant: string; active: boolean }[] = [];
  for await (const scope of fanOutTenants(
    w.context.control,
    w.context.directory,
    w.source,
    entry,
    pageSize,
    new AbortController().signal,
  )) {
    found.push({ tenant: scope.scopeId, active: scope.active });
  }
  return found;
}

test('a tenant costs no directory read; a backend costs one', async () => {
  const w = makePassWorld({ one: ['a1', 'a2', 'a3'], two: ['b1', 'b2'] });
  w.suspended.add('a2');
  const found = await scopesOf(w, 2);
  expect(found.map((scope) => scope.tenant).toSorted()).toEqual(['a1', 'a2', 'a3', 'b1', 'b2']);
  expect(found.find((scope) => scope.tenant === 'a2')?.active).toBe(false);
  expect(found.find((scope) => scope.tenant === 'a1')?.active).toBe(true);
  expect(w.reads).toEqual({ backend: 2, tenant: 0 });
});

test('a backend with many tenants does not come before the others of its page of backends', async () => {
  const w = makePassWorld({ one: ['a1', 'a2', 'a3', 'a4', 'a5'], two: ['b1'] });
  const found = await scopesOf(w, 2);
  expect(found.map((scope) => scope.tenant)).toEqual(['a1', 'a2', 'b1', 'a3', 'a4', 'a5']);
});

test('the seeding of a pass reaches every backend before it finishes the largest', async () => {
  const w = makePassWorld({ one: ['a1', 'a2', 'a3', 'a4', 'a5'], two: ['b1'] });
  (w.state as { reseedAt: Temporal.Instant | undefined }).reseedAt = undefined;
  await w.pass({ seedPerPass: 3, pageSize: 2 });
  expect([...w.rows.values()].map((row) => row.scopeId).toSorted()).toEqual(['a1', 'a2', 'b1']);
});

test('a directory read that never answers is cut by the signal, which rejects the fan-out', async () => {
  const w = makePassWorld({ one: ['a1'] });
  const entry = w.source.registry.schedules.values().next().value;
  if (entry === undefined) throw new Error('no schedule');
  let asked = 0;
  vi.spyOn(w.context.directory, 'backend').mockImplementation(() => {
    asked += 1;
    return new Promise(() => undefined);
  });
  const abort = new AbortController();
  const scopes = fanOutTenants(
    w.context.control,
    w.context.directory,
    w.source,
    entry,
    2,
    abort.signal,
  );
  const outcome = expect(scopes.next()).rejects.toThrow('stopped');
  await vi.waitFor(() => expect(asked).toBeGreaterThan(0));
  abort.abort(new Error('stopped'));
  await outcome;
});
