import { errors } from '@keelwerk/core';
import { afterEach, describe, expect, test } from 'vitest';
import { expectedOf, type OrderCase, sampleOf } from './support/effect-orders-model.ts';
import { run } from './support/effect-secrets-app.ts';
import { type BootedSecretVault, bootSecretVault } from './support/effect-secrets-kit.ts';
import { useUpperDraws } from './support/use-upper-draws.ts';

useUpperDraws();

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.allSettled(cleanup.splice(0).map((close) => close()));
});

/** The seed and size of the sample: the same ones draw the same orders on every run. */
const seed = 126;
const size = 175;

const inputOpens = async (booted: BootedSecretVault, id: string) => {
  const { key, backup } = booted.texts(await booted.effectRow(id));
  return [await booted.opens(key), await booted.opens(backup)];
};

/** Settles the effect behind the back of its hanging attempt, below the write path. */
async function settleMeanwhile(booted: BootedSecretVault, id: string) {
  const row = await booted.effectRow(id);
  const descriptor = booted.runtime.app.registry.entities.get('core.effect')?.descriptor;
  if (descriptor === undefined) throw new Error('no core.effect');
  await booted.raw((unit) =>
    unit.rows.update(descriptor, [
      { id, expectedVersion: Number(row.version), values: { ...row, status: 'abandoned' } },
    ]),
  );
}

/** Plays the order with the clock the test moves: attempt n starts one second after the end of the one before, a hanging one ends after its expiry. */
async function play(booted: BootedSecretVault, order: OrderCase): Promise<string> {
  const spy = booted.spy;
  const failEnd = /^end(\d)$/.exec(order.injection)?.[1];
  let failed = false;
  if (failEnd !== undefined) {
    spy.complete = (attempt) => {
      if (failed || attempt.attempt !== Number(failEnd)) return undefined;
      failed = true;
      throw new Error('the store failed');
    };
  }
  if (order.injection === 'enqueue') {
    spy.beforeEnqueue = (job) => {
      if (failed || job.key?.value.startsWith('core.continuation:') !== true) return;
      failed = true;
      throw errors.internal('the enqueue failed once');
    };
  }
  run.script = order.steps;
  let at = 0;
  let id = '';
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const step = order.steps[attempt - 1] ?? 'ok';
    run.hanging = Promise.withResolvers<void>();
    // Moving the clock drains the workers: it waits for an attempt it starts, so it is awaited last.
    let due: Promise<unknown> = Promise.resolve();
    if (attempt === 1) {
      id = await booted.open('script');
    } else {
      at += 1;
      due = booted.advance(at);
    }
    if (step === 'hang') {
      await run.hanging.promise;
      const draining = booted.drain();
      if (order.meanwhile && attempt === order.steps.length) await settleMeanwhile(booted, id);
      at += 6;
      await booted.advance(at);
      await Promise.all([due, draining]);
    } else {
      await due;
      await booted.drain();
    }
    if ((await booted.effectRow(id)).status !== 'requested') return id;
    // An attempt that ended in a retry keeps the secrets for the next one.
    expect(await inputOpens(booted, id)).toEqual([true, true]);
  }
  return id;
}

describe('orders of the attempts of an effect, its timeouts, its settle and the failures around it', () => {
  test.each(sampleOf(seed, size).map((order) => [JSON.stringify(order), order] as const))(
    '%s',
    async (_name, order) => {
      const booted = await bootSecretVault({ adapter: 'memory', watched: true }, cleanup);
      const want = expectedOf(order);
      const id = await play(booted, order);
      const row = await booted.effectRow(id);
      expect(row).toMatchObject({ status: want.status, attempts: want.attempts });
      if (want.code !== undefined) expect(row).toMatchObject({ error: { code: want.code } });
      // The input secrets are gone, the output secret lives with a success, the attempt count is the last attempt that started.
      // (A row that something else settled below the write path went through no settle of the kernel: its keys are as they were.)
      const settledByKernel = want.ledger !== 'none';
      expect(await inputOpens(booted, id)).toEqual([!settledByKernel, !settledByKernel]);
      if (want.status === 'succeeded') {
        expect(await booted.opens(booted.texts(row).seal)).toBe(true);
      }
      const records = await booted.attemptRecords(id);
      const highest = Math.max(...records.map((record) => Number(record.attempt)));
      expect(highest).toBe(want.started);
      // Every attempt but the last ended in a retry, and none was retried after the effect was settled.
      const retries = booted.spy.completions.filter((entry) => entry.outcome.kind === 'retry');
      expect(retries).toHaveLength(want.started - 1);
      // The continuation ran once, and what it recorded says what the settle was.
      const ledger = await booted.rows('vault.ledger');
      if (want.ledger === 'none') expect(ledger).toHaveLength(0);
      else if (want.ledger === 'proof') {
        expect(ledger.map((entry) => entry.proof)).toEqual([`key marker#${want.attempts}`]);
      } else expect(ledger.map((entry) => entry.code)).toEqual([want.code]);
      // Nothing moves afterwards: no later take, no second settle, no second continuation.
      await booted.advance(10_000);
      await booted.drain();
      expect(await booted.effectRow(id)).toEqual(row);
      expect(await booted.attemptRecords(id)).toEqual(records);
      expect(await booted.rows('vault.ledger')).toHaveLength(ledger.length);
    },
  );
});
