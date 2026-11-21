import { expect } from 'vitest';
import { boot } from './prepare-admission-world.ts';

/**
 * A first attempt of a command with `prepare`, held inside its executor after its admission and its
 * first effect record. The tenant is then put above both limits (both counters stand above 0), a
 * command of the tenant is refused to show that the limits are in force, and the attempt is
 * released. What decides it: the barrier the test releases (no timer, no clock), the awaited
 * answers, the committed store and the counters.
 */
export async function heldOverTheLimits(
  action: string,
  input: unknown,
  options: Parameters<typeof boot>[0] = {},
) {
  const { world, adapter, invoke, read, registry } = boot(options);
  expect((await invoke('library.grow', { isbn: 'g-1' })).ok).toBe(true);
  const id = '00000000-0000-7000-8000-000000000201';
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  world.onRun = async () => {
    entered.resolve();
    await release.promise;
  };
  const first = invoke(action, input, { commandId: id });
  let before: readonly [bigint, bigint];
  try {
    await entered.promise;
    world.bytes = 0;
    world.rows = 0;
    before = await read();
    expect(before[0]).toBeGreaterThan(0n);
    expect(before[1]).toBeGreaterThan(0n);
    expect(await invoke('library.grow', { isbn: 'g-2' })).toMatchObject({
      ok: false,
      error: { code: 'core.quota_exceeded' },
    });
  } finally {
    release.resolve();
  }
  const done = await first;
  return { world, adapter, registry, read, id, done, before };
}
