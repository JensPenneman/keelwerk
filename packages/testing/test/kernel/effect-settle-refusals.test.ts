import { errors } from '@keelwerk/core';
import { afterEach, describe, expect, test } from 'vitest';
import { run } from './support/effect-secrets-app.ts';
import { type BootedSecretVault, bootSecretVault } from './support/effect-secrets-kit.ts';
import { useUpperDraws } from './support/use-upper-draws.ts';

useUpperDraws();

const cleanup: (() => Promise<void>)[] = [];
const restore: (() => void)[] = [];
afterEach(async () => {
  for (const undo of restore.splice(0)) undo();
  await Promise.allSettled(cleanup.splice(0).map((close) => close()));
});

async function inputOpens(booted: BootedSecretVault, id: string): Promise<boolean[]> {
  const { key, backup } = booted.texts(await booted.effectRow(id));
  return [await booted.opens(key), await booted.opens(backup)];
}

describe('what the settle of an effect does when something around it fails', () => {
  test('a continuation that no enqueue accepts leaves the effect requested and its job failed: nothing is dropped, nothing repairs it', async () => {
    const booted = await bootSecretVault({ adapter: 'memory', watched: true }, cleanup);
    let refused = 0;
    booted.spy.beforeEnqueue = (job) => {
      if (job.key?.value.startsWith('core.continuation:') !== true) return;
      refused += 1;
      throw errors.validation('the continuation input no longer fits');
    };
    const id = await booted.open('ok');
    await booted.drain();
    // Every later take meets the same refusal; the clock moves far past every retry and the effect's expiry.
    for (const seconds of [10, 100, 1000, 10_000, 100_000]) {
      await booted.advance(seconds);
      await booted.drain();
    }
    expect(refused).toBeGreaterThan(0);
    expect(await booted.effectRow(id)).toMatchObject({ status: 'requested' });
    expect(booted.spy.completions.map((entry) => entry.outcome.kind).at(-1)).toBe('failed');
    expect(await booted.rows('vault.ledger')).toHaveLength(0);
    // It never settled, so its input secrets are still open.
    expect(await inputOpens(booted, id)).toEqual([true, true]);
  });

  test('an executor answer the kernel cannot take, with a retry left after the end unit failed, settles abandoned and runs the executor once', async () => {
    const booted = await bootSecretVault({ adapter: 'memory', watched: true }, cleanup);
    // The answer is checked against the output shape, which here fails the way a store does: a failure that a retry would otherwise cover.
    const entry = booted.runtime.app.registry.effects.get('vault.lock') as unknown as {
      output: unknown;
    };
    const kept = entry.output;
    entry.output = {
      '~standard': {
        version: 1,
        vendor: 'test',
        validate: () => {
          throw errors.unavailable('The store is busy.');
        },
      },
    };
    restore.push(() => {
      entry.output = kept;
    });
    let failed = false;
    booted.spy.complete = () => {
      if (failed) return undefined;
      failed = true;
      throw new Error('the store failed');
    };
    run.attempts = 0;
    const id = await booted.open('ok');
    await booted.drain();
    await booted.advance(3600);
    await booted.drain();
    expect(await booted.effectRow(id)).toMatchObject({
      status: 'abandoned',
      attempts: 1,
      error: { code: 'core.effect_outcome_unknown' },
    });
    expect(run.attempts).toBe(1);
    expect(await inputOpens(booted, id)).toEqual([false, false]);
  });
});
