import { afterEach, describe, expect, test } from 'vitest';
import { type BootedSecretVault, bootSecretVault } from './support/effect-secrets-kit.ts';
import { useUpperDraws } from './support/use-upper-draws.ts';

useUpperDraws();

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.allSettled(cleanup.splice(0).map((close) => close()));
});

/** Whether the two input secrets of an effect still open. */
async function inputOpens(booted: BootedSecretVault, id: string): Promise<boolean[]> {
  const { key, backup } = booted.texts(await booted.effectRow(id));
  return [await booted.opens(key), await booted.opens(backup)];
}

describe.each(['memory', 'pglite'] as const)('the input secrets of an effect on %s', (adapter) => {
  test('no input secret of the effect opens after it settled succeeded, and its output secret still does', async () => {
    const booted = await bootSecretVault({ adapter }, cleanup);
    const id = await booted.open('ok');
    await booted.drain();
    const row = await booted.effectRow(id);
    expect(row).toMatchObject({ status: 'succeeded' });
    expect(await inputOpens(booted, id)).toEqual([false, false]);
    expect(await booted.opens(booted.texts(row).seal)).toBe(true);
    // The executor revealed the key during its attempt, and the continuation ran once.
    expect((await booted.rows('vault.ledger')).map((entry) => entry.proof)).toEqual([
      'key marker#1',
    ]);
  });

  test('no input secret opens after the effect settled failed', async () => {
    const booted = await bootSecretVault({ adapter }, cleanup);
    const id = await booted.open('fail');
    await booted.drain();
    expect(await booted.effectRow(id)).toMatchObject({ status: 'failed' });
    expect(await inputOpens(booted, id)).toEqual([false, false]);
    expect((await booted.rows('vault.ledger')).map((entry) => entry.ok)).toEqual([false]);
  });

  test("no input secret opens after an outside performer's settle, and its output secret still does", async () => {
    const booted = await bootSecretVault({ adapter }, cleanup);
    const id = await booted.open('outside', { external: true });
    expect(await inputOpens(booted, id)).toEqual([true, true]);
    expect((await booted.call('vault.report', { effectId: id })).ok).toBe(true);
    await booted.drain();
    const row = await booted.effectRow(id);
    expect(row).toMatchObject({ status: 'succeeded' });
    expect(await inputOpens(booted, id)).toEqual([false, false]);
    expect(await booted.opens(booted.texts(row).seal)).toBe(true);
  });

  test('no input secret opens after the deadline of an outside effect settled it failed', async () => {
    const booted = await bootSecretVault({ adapter }, cleanup);
    const id = await booted.open('late', {
      external: true,
      deadline: Temporal.Instant.from('2026-03-01T08:01:00Z').toString(),
    });
    expect(await inputOpens(booted, id)).toEqual([true, true]);
    await booted.advance(61);
    await booted.drain();
    expect(await booted.effectRow(id)).toMatchObject({
      status: 'failed',
      error: { code: 'core.effect_deadline' },
    });
    expect(await inputOpens(booted, id)).toEqual([false, false]);
  });

  test('a retried attempt keeps the input secrets and reveals them again', async () => {
    const booted = await bootSecretVault({ adapter }, cleanup);
    const id = await booted.open('retry');
    await booted.drain();
    expect(await booted.effectRow(id)).toMatchObject({ status: 'requested' });
    expect(await inputOpens(booted, id)).toEqual([true, true]);
    await booted.advance(10);
    await booted.drain();
    expect(await booted.effectRow(id)).toMatchObject({ status: 'succeeded', attempts: 2 });
    expect(await inputOpens(booted, id)).toEqual([false, false]);
    // The second attempt revealed the key again.
    expect((await booted.rows('vault.ledger')).map((entry) => entry.proof)).toEqual([
      'key marker#2',
    ]);
  });
});

describe('the input secrets of an effect that an attempt left open', () => {
  test('no input secret opens after the next take settled it abandoned at its begin', async () => {
    const booted = await bootSecretVault({ adapter: 'memory', watched: true }, cleanup);
    // The end unit of the first attempt finds its lease gone: the attempt stays open.
    let completions = 0;
    booted.spy.complete = () => (completions++ === 0 ? false : undefined);
    const id = await booted.open('ok');
    await booted.drain();
    expect(await booted.effectRow(id)).toMatchObject({ status: 'requested' });
    expect(await inputOpens(booted, id)).toEqual([true, true]);
    await booted.advance(120);
    await booted.drain();
    expect(await booted.effectRow(id)).toMatchObject({
      status: 'abandoned',
      error: { code: 'core.effect_outcome_unknown' },
    });
    expect(await inputOpens(booted, id)).toEqual([false, false]);
  });
});
