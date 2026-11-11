import { expect, test } from 'vitest';
import { asOperator, bootTargeting, callAs, setFlag, storedFlag } from './support/targeting-kit.ts';

const second = { seconds: 1 } as const;

// The embedded database boots and takes six writes here: under a loaded machine that passes five seconds.
test('on the embedded SQL adapter the targeting is written to core.flag, read back by the cache, restored and refused when it holds @', async () => {
  const runtime = await bootTargeting({ adapter: 'pglite' });
  const { acme } = runtime.tenants;
  const pilot = {
    enabled: true,
    rules: [{ id: 'pilot', tenants: [acme.id], serve: { value: true } }],
    fallthrough: { value: false },
  };
  const set = await setFlag(runtime, { key: 'rollout.beta', targeting: pilot, reason: 'pilot' });
  if (!set.ok) throw set.error;
  expect(set.value.ruleVersion).toBe(1);
  const stored = await storedFlag(runtime, set.value.id);
  expect(stored.row).toMatchObject({
    slot: 'rollout.beta',
    key: 'rollout.beta',
    version: 1,
    targeting: pilot,
  });
  // The cache reads the rows back through ControlFlags.rows() on this adapter.
  await runtime.advanceTo(runtime.clock.now().add(second));
  expect(await callAs(runtime, 'acme', 'rollout.readBeta', { text: 'a' })).toMatchObject({
    ok: true,
    value: { beta: true },
  });
  expect(await callAs(runtime, 'globex', 'rollout.readBeta', { text: 'g' })).toMatchObject({
    ok: true,
    value: { beta: false },
  });
  // A second write to the same slot updates the row; its previous rule set is kept.
  const off = { ...pilot, enabled: false };
  const again = await setFlag(runtime, { key: 'rollout.beta', targeting: off, reason: 'stop' });
  expect(again).toMatchObject({ ok: true, value: { id: set.value.id, ruleVersion: 2 } });
  expect((await storedFlag(runtime, set.value.id)).row).toMatchObject({
    version: 2,
    targeting: off,
    previous: pilot,
  });
  await runtime.advanceTo(runtime.clock.now().add(second));
  expect(await callAs(runtime, 'acme', 'rollout.readBeta', { text: 'b' })).toMatchObject({
    ok: true,
    value: { beta: false },
  });
  const restored = await asOperator(runtime, 'core.flag.restoreRules', {
    id: set.value.id,
    ifVersion: 2,
    reason: 'undo',
  });
  expect(restored).toMatchObject({ ok: true });
  expect((await storedFlag(runtime, set.value.id)).row).toMatchObject({
    version: 3,
    targeting: pilot,
    previous: off,
  });
  await runtime.advanceTo(runtime.clock.now().add(second));
  expect(await callAs(runtime, 'acme', 'rollout.readBeta', { text: 'c' })).toMatchObject({
    ok: true,
    value: { beta: true },
  });
  // A key that holds @ cannot take the slot of a backend's row.
  expect(
    await setFlag(runtime, {
      key: `rollout.beta@${runtime.backendId}`,
      targeting: off,
      reason: 'try',
    }),
  ).toMatchObject({ ok: false, error: { kind: 'validation' } });
}, 30_000);
