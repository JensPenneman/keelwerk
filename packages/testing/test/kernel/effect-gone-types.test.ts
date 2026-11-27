import { field, parseSealedValueText, shape } from '@keelwerk/core';
import { afterEach, describe, expect, test } from 'vitest';
import { type BootedSecretVault, bootSecretVault } from './support/effect-secrets-kit.ts';
import { bootCourier } from './support/erasure-courier-kit.ts';
import { useUpperDraws } from './support/use-upper-draws.ts';

useUpperDraws();

const cleanup: (() => Promise<void>)[] = [];
const restore: (() => void)[] = [];
afterEach(async () => {
  for (const undo of restore.splice(0)) undo();
  await Promise.allSettled(cleanup.splice(0).map((close) => close()));
});

/** Takes entries out of a map of the registry (the app object is shared by every test), as a build that no longer has them; the test's end puts them back. */
function drop(map: unknown, keys: readonly string[]): void {
  const held = map as Map<string, unknown>;
  const saved = keys.flatMap((key) => (held.has(key) ? [[key, held.get(key)] as const] : []));
  expect(saved).toHaveLength(keys.length);
  for (const key of keys) held.delete(key);
  restore.push(() => {
    for (const [key, value] of saved) held.set(key, value);
  });
}

async function inputOpens(booted: BootedSecretVault, id: string): Promise<boolean[]> {
  const { key, backup } = booted.texts(await booted.effectRow(id));
  return [await booted.opens(key), await booted.opens(backup)];
}

describe('a build that no longer has what performs an effect still settles it without leaving its input secrets open', () => {
  test('the executor is gone and the effect type kept: the effect settles failed, its continuation runs and no input secret opens', async () => {
    const booted = await bootSecretVault({ adapter: 'memory', watched: true }, cleanup);
    // The build that takes the job has lost the executor, not the type: it goes right before the first take.
    booted.spy.refuseTake = () => {
      drop(booted.runtime.app.registry.executors, [
        ...booted.runtime.app.registry.executors.keys(),
      ]);
      booted.spy.refuseTake = undefined;
      return false;
    };
    const id = await booted.open('ok');
    await booted.drain();
    expect(await booted.effectRow(id)).toMatchObject({
      status: 'failed',
      error: { code: 'core.internal' },
    });
    expect(await inputOpens(booted, id)).toEqual([false, false]);
    // The registry holds the type and the continuation command, so the continuation ran with the failure.
    expect((await booted.rows('vault.ledger')).map((entry) => entry.code)).toEqual([
      'core.internal',
    ]);
  });

  test('the effect type is gone: the deadline settles the effect failed and no input secret opens', async () => {
    const booted = await bootSecretVault({ adapter: 'memory' }, cleanup);
    const deadline = Temporal.Instant.from('2026-03-01T08:00:30Z');
    const id = await booted.open('late', { external: true, deadline: deadline.toString() });
    expect(await inputOpens(booted, id)).toEqual([true, true]);
    drop(booted.runtime.app.registry.effects, ['vault.hold']);
    await booted.advance(60);
    await booted.drain();
    expect(await booted.effectRow(id)).toMatchObject({
      status: 'failed',
      error: { code: 'core.effect_deadline' },
    });
    expect(await inputOpens(booted, id)).toEqual([false, false]);
    // Nothing names a continuation of a type the build lacks.
    expect(await booted.rows('vault.ledger')).toHaveLength(0);
  });

  test('the effect type is gone: the erasure of its subject settles the effect and destroys its keys, each tombstoned first', async () => {
    const booted = await bootCourier({ adapter: 'memory' });
    cleanup.push(() => booted.runtime.stop());
    const requested = await booted.send({ parcel: 'requested' });
    const waybill = ((await booted.effectRow(requested.id)).input as { waybill: string }).waybill;
    expect(await booted.opens(waybill)).toBe(true);
    drop(booted.runtime.app.registry.effects, ['courier.ship']);
    await booted.ask();
    await booted.worker.pass();
    await booted.runtime.drainJobs();
    expect(await booted.effectRow(requested.id)).toMatchObject({
      status: 'failed',
      error: { code: 'core.key_destroyed' },
    });
    expect(await booted.opens(waybill)).toBe(false);
    expect(await booted.tombstones()).toContain(parseSealedValueText(waybill)?.keyId);
  });

  test('the effect type is gone: the erasure of the subject of a settled effect destroys its output key, tombstoned', async () => {
    const booted = await bootCourier({ adapter: 'memory' });
    cleanup.push(() => booted.runtime.stop());
    const reported = await booted.send({ parcel: 'reported' });
    await booted.report(reported.id);
    const seal = ((await booted.effectRow(reported.id)).output as { seal: string }).seal;
    expect(await booted.opens(seal)).toBe(true);
    drop(booted.runtime.app.registry.effects, ['courier.ship']);
    await booted.ask();
    await booted.worker.pass();
    await booted.runtime.drainJobs();
    expect(await booted.opens(seal)).toBe(false);
    expect(await booted.tombstones()).toContain(parseSealedValueText(seal)?.keyId);
  });

  test("the type is kept but its input shape no longer has a secret member: the settle still destroys that member's key", async () => {
    const booted = await bootSecretVault({ adapter: 'memory', watched: true }, cleanup);
    const entry = booted.runtime.app.registry.effects.get('vault.lock') as unknown as {
      input: unknown;
    };
    const kept = entry.input;
    restore.push(() => {
      entry.input = kept;
    });
    // The build that takes the job has a shape of the input without `backup`.
    booted.spy.refuseTake = () => {
      entry.input = shape({ mode: field.string(), key: field.secret() });
      booted.spy.refuseTake = undefined;
      return false;
    };
    const id = await booted.open('ok');
    await booted.drain();
    expect((await booted.effectRow(id)).status).not.toBe('requested');
    expect(await inputOpens(booted, id)).toEqual([false, false]);
  });
});
