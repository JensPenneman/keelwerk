import { errors } from '@keelwerk/core';
import { afterEach, describe, expect, test } from 'vitest';
import { run } from './support/effect-secrets-app.ts';
import { type BootedSecretVault, bootSecretVault } from './support/effect-secrets-kit.ts';
import { useUpperDraws } from './support/use-upper-draws.ts';

useUpperDraws();

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.allSettled(cleanup.splice(0).map((close) => close()));
});

/**
 * The attempt of a hanging executor, ended by the clock: `start` makes the attempt due, `end` is
 * past its expiry (5 s). Moving the clock drains the workers, so it waits for the attempt it starts.
 */
async function hangingAttempt(booted: BootedSecretVault, at: { start: number; end: number }) {
  run.hanging = Promise.withResolvers<void>();
  const due = booted.advance(at.start);
  const draining = booted.drain();
  await run.hanging.promise;
  await booted.advance(at.end);
  await Promise.all([due, draining]);
}

/** An effect whose executor hangs until the third attempt has ended by timeout (the retry limit is 3, the delay 1 s). */
async function timedOutThrice(booted: BootedSecretVault, over: { last?: () => void } = {}) {
  run.hanging = Promise.withResolvers<void>();
  const id = await booted.open('hang');
  await run.hanging.promise;
  const draining = booted.drain();
  await booted.advance(6);
  await draining;
  expect(await booted.effectRow(id)).toMatchObject({ status: 'requested' });
  await hangingAttempt(booted, { start: 8, end: 14 });
  expect(await booted.effectRow(id)).toMatchObject({ status: 'requested' });
  over.last?.();
  await hangingAttempt(booted, { start: 16, end: 22 });
  return id;
}

const unknown = { status: 'abandoned', error: { code: 'core.effect_outcome_unknown' } };

describe.each(['memory', 'pglite'] as const)('an attempt that times out on %s', (adapter) => {
  test('with no retry left settles the effect abandoned with core.effect_outcome_unknown, its continuation told, and the earlier timeouts were retried', async () => {
    const booted = await bootSecretVault({ adapter }, cleanup);
    const id = await timedOutThrice(booted);
    expect(await booted.effectRow(id)).toMatchObject({ ...unknown, attempts: 3 });
    const ended = (await booted.attemptRecords(id)).filter(
      (record) => record.endedAt !== undefined,
    );
    expect(ended.map((record) => (record.error as { code: string }).code)).toEqual([
      'core.timeout',
      'core.timeout',
      'core.effect_outcome_unknown',
    ]);
    expect((await booted.rows('vault.ledger')).map((entry) => [entry.ok, entry.code])).toEqual([
      [false, 'core.effect_outcome_unknown'],
    ]);
  });
});

describe('an attempt that times out, on the memory adapter with its job store watched', () => {
  test('with no retry left settles abandoned in a fresh unit when its end unit failed', async () => {
    const booted = await bootSecretVault({ adapter: 'memory', watched: true }, cleanup);
    let failures = 0;
    const id = await timedOutThrice(booted, {
      last: () => {
        booted.spy.complete = (attempt) => {
          if (attempt.attempt !== 3 || failures > 0) return undefined;
          failures += 1;
          throw new Error('the store failed');
        };
      },
    });
    expect(failures).toBe(1);
    expect(await booted.effectRow(id)).toMatchObject({ ...unknown, attempts: 3 });
    expect((await booted.rows('vault.ledger')).map((entry) => entry.code)).toEqual([
      'core.effect_outcome_unknown',
    ]);
  });

  test('after its effect was settled meanwhile ends its job succeeded with its end record, and is not retried', async () => {
    const booted = await bootSecretVault({ adapter: 'memory', watched: true }, cleanup);
    run.hanging = Promise.withResolvers<void>();
    const id = await booted.open('hang');
    await run.hanging.promise;
    const draining = booted.drain();
    // Something else settles the effect while the attempt hangs.
    const row = await booted.effectRow(id);
    const descriptor = booted.runtime.app.registry.entities.get('core.effect')?.descriptor;
    if (descriptor === undefined) throw new Error('no core.effect');
    await booted.raw((unit) =>
      unit.rows.update(descriptor, [
        { id, expectedVersion: Number(row.version), values: { ...row, status: 'abandoned' } },
      ]),
    );
    await booted.advance(6);
    await draining;
    expect(booted.spy.completions.map((entry) => entry.outcome.kind)).toEqual(['succeeded']);
    const records = await booted.attemptRecords(id);
    expect(records).toHaveLength(2);
    expect(records[1]).toHaveProperty('endedAt');
    expect(records[1]).not.toHaveProperty('error');
    await booted.advance(30);
    await booted.drain();
    expect(await booted.attemptRecords(id)).toHaveLength(2);
    expect(await booted.effectRow(id)).toMatchObject({ status: 'abandoned' });
  });
});

describe('the continuation of an effect', () => {
  test('is not dropped by an internal failure while it is enqueued: it runs once', async () => {
    const booted = await bootSecretVault({ adapter: 'memory', watched: true }, cleanup);
    let failures = 0;
    booted.spy.beforeEnqueue = (job) => {
      if (job.key?.value.startsWith('core.continuation:') === true && failures === 0) {
        failures += 1;
        throw errors.internal('the enqueue failed once');
      }
    };
    const id = await booted.open('ok');
    await booted.drain();
    expect(failures).toBe(1);
    expect(await booted.effectRow(id)).toMatchObject({ status: 'succeeded' });
    expect((await booted.rows('vault.ledger')).map((entry) => entry.proof)).toEqual([
      'key marker#1',
    ]);
  });
});
