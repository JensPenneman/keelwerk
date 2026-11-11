import { expect, test } from 'vitest';
import { asOperator, bootTargeting, callAs, setFlag } from './support/targeting-kit.ts';

const valid = { enabled: true, rules: [], fallthrough: { value: true } };

test('an invalid value is refused on write and nothing is stored', async () => {
  const runtime = await bootTargeting();
  const bad = (key: string, targeting: unknown) =>
    setFlag(runtime, { key, targeting, reason: 'try' });
  expect(await bad('rollout.beta', { ...valid, fallthrough: { value: 'yes' } })).toMatchObject({
    ok: false,
    error: { kind: 'validation' },
  });
  expect(await bad('rollout.unknown', valid)).toMatchObject({
    ok: false,
    error: { kind: 'validation' },
  });
  expect(
    await bad('rollout.beta', {
      ...valid,
      rules: [{ id: 'mail', when: { email: 'a@b.c' }, serve: { value: true } }],
    }),
  ).toMatchObject({ ok: false, error: { kind: 'validation' } });
  const rows = await asOperator(runtime, 'core.flag.query', {});
  expect(rows).toMatchObject({ ok: true });
  expect(rows.ok && (rows.value as { items?: unknown[] }).items).toEqual([]);
});

test('restoreRules returns the previous rule set and history lists both changes with their reasons', async () => {
  const runtime = await bootTargeting();
  const first = await setFlag(runtime, { key: 'rollout.beta', targeting: valid, reason: 'first' });
  if (!first.ok) throw first.error;
  const off = { ...valid, enabled: false };
  expect(
    await setFlag(runtime, { key: 'rollout.beta', targeting: off, reason: 'second' }),
  ).toMatchObject({
    ok: true,
    value: { id: first.value.id, ruleVersion: 2 },
  });
  expect(
    await setFlag(runtime, { key: 'rollout.beta', targeting: off, reason: 'second' }),
  ).toMatchObject({
    ok: true,
    value: { ruleVersion: 2 },
  });
  expect(
    await asOperator(runtime, 'core.flag.restoreRules', {
      id: first.value.id,
      ifVersion: 2,
      reason: 'undo',
    }),
  ).toMatchObject({ ok: true });
  const row = await asOperator(runtime, 'core.flag.get', { ids: [first.value.id] });
  expect(row.ok && (row.value.list as { targeting: unknown; version: number }[])[0]).toMatchObject({
    targeting: valid,
    version: 3,
  });
  const history = await asOperator(runtime, 'core.flag.history', { id: first.value.id });
  const entries = history.ok
    ? (history.value.entries as { changes: { reason?: { after: string } } }[])
    : [];
  expect(entries.map((entry) => entry.changes.reason?.after)).toEqual(['first', 'second', 'undo']);
});

test('a write that changes only the reason keeps the earlier rule set reachable', async () => {
  const runtime = await bootTargeting();
  const t1 = valid;
  const t2 = { ...valid, enabled: false };
  const first = await setFlag(runtime, { key: 'rollout.beta', targeting: t1, reason: 'a' });
  if (!first.ok) throw first.error;
  await setFlag(runtime, { key: 'rollout.beta', targeting: t2, reason: 'b' });
  expect(await setFlag(runtime, { key: 'rollout.beta', targeting: t2, reason: 'c' })).toMatchObject(
    { ok: true, value: { ruleVersion: 3 } },
  );
  expect(
    await asOperator(runtime, 'core.flag.restoreRules', {
      id: first.value.id,
      ifVersion: 3,
      reason: 'undo',
    }),
  ).toMatchObject({ ok: true });
  const row = await asOperator(runtime, 'core.flag.get', { ids: [first.value.id] });
  expect(row.ok && (row.value.list as { targeting: unknown }[])[0]?.targeting).toEqual(t1);
});

test('a flag that was never changed has no earlier rule set', async () => {
  const runtime = await bootTargeting();
  const first = await setFlag(runtime, { key: 'rollout.beta', targeting: valid, reason: 'first' });
  if (!first.ok) throw first.error;
  expect(
    await asOperator(runtime, 'core.flag.restoreRules', {
      id: first.value.id,
      ifVersion: 1,
      reason: 'undo',
    }),
  ).toMatchObject({ ok: false, error: { kind: 'conflict' } });
});

test('a restore names the version it was decided on: a change that came in between is a conflict, never a retry that restores something else', async () => {
  const runtime = await bootTargeting();
  const targeting = (enabled: boolean, value: boolean) => ({
    enabled,
    rules: [],
    fallthrough: { value },
  });
  const a = targeting(true, true);
  const b = targeting(false, true);
  const d = targeting(true, false);
  const first = await setFlag(runtime, { key: 'rollout.beta', targeting: a, reason: 'a' });
  if (!first.ok) throw first.error;
  await setFlag(runtime, { key: 'rollout.beta', targeting: b, reason: 'b' });
  // Operator 1 saw version 2 (b, previous a); operator 2 writes d before the restore arrives.
  await setFlag(runtime, { key: 'rollout.beta', targeting: d, reason: 'd' });
  const id = first.value.id;
  expect(
    await asOperator(runtime, 'core.flag.restoreRules', { id, ifVersion: 2, reason: 'back to a' }),
  ).toMatchObject({ ok: false, error: { kind: 'conflict', code: 'core.version_mismatch' } });
  const row = await asOperator(runtime, 'core.flag.get', { ids: [id] });
  expect(row.ok && (row.value.list as { targeting: unknown; version: number }[])[0]).toMatchObject({
    targeting: d,
    version: 3,
  });
  expect(
    await asOperator(runtime, 'core.flag.restoreRules', { id, ifVersion: 3, reason: 'back to b' }),
  ).toMatchObject({ ok: true });
});

test('a restore without ifVersion is refused as invalid input', async () => {
  const runtime = await bootTargeting();
  const first = await setFlag(runtime, { key: 'rollout.beta', targeting: valid, reason: 'a' });
  if (!first.ok) throw first.error;
  await setFlag(runtime, {
    key: 'rollout.beta',
    targeting: { ...valid, enabled: false },
    reason: 'b',
  });
  expect(
    await asOperator(runtime, 'core.flag.restoreRules', { id: first.value.id, reason: 'undo' }),
  ).toMatchObject({ ok: false, error: { kind: 'validation' } });
});

test('a flag key that holds @ is refused, so no key can take the slot of a backend row', async () => {
  const runtime = await bootTargeting();
  const refused = await setFlag(runtime, {
    key: `rollout.beta@${runtime.backendId}`,
    targeting: valid,
    reason: 'try',
  });
  expect(refused).toMatchObject({ ok: false, error: { kind: 'validation' } });
});

test('a tenant principal cannot read core.flag rows', async () => {
  const runtime = await bootTargeting();
  await setFlag(runtime, { key: 'rollout.beta', targeting: valid, reason: 'first' });
  for (const action of ['core.flag.query', 'core.flag.get']) {
    const outcome = await callAs(
      runtime,
      'acme',
      action,
      action.endsWith('get') ? { ids: [] } : {},
    );
    expect(['forbidden', 'not_found']).toContain(outcome.ok ? 'ok' : outcome.error.kind);
  }
});

test('the registered actions include core.flag.set, core.flag.restoreRules and core.flag.evaluate', async () => {
  const runtime = await bootTargeting();
  for (const ref of ['core.flag.set', 'core.flag.restoreRules', 'core.flag.evaluate']) {
    expect(runtime.app.registry.actions.has(ref)).toBe(true);
  }
});
