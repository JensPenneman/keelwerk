import { scrubReceiptFingerprints } from '@keelwerk/core';
import { afterEach, describe, expect, test } from 'vitest';
import type { TestRuntime } from '../../src/harness/test-runtime.ts';
import type { erasureDumpApp } from './support/erasure-probe-module.ts';
import { bootErasureRules, stopBooted } from './support/erasure-rules-kit.ts';
import { scopeOf } from './support/restart-kit.ts';

afterEach(stopBooted);

type Runtime = TestRuntime<typeof erasureDumpApp>;

const timeout = 60_000;
const keyedFingerprint = /^kwf1\.[0-9a-f]{64}$/;
const opened = '00000000-0000-7000-8000-000000000101';
const sent = '00000000-0000-7000-8000-000000000102';
const elsewhere = '00000000-0000-7000-8000-000000000103';

const fingerprintOf = (runtime: Runtime, commandId: string) =>
  runtime.adapter.unit(
    runtime.namespace,
    scopeOf(runtime),
    async (unit) => (await unit.receipts.get(commandId))?.fingerprint,
    { readOnly: true },
  );

/**
 * A client that calls actions by reference: the probe app's types name subject ids and row ids that
 * a test builds from text.
 */
const loose = (client: unknown) =>
  client as {
    invoke: (action: string, input: unknown, options?: unknown) => Promise<unknown>;
    attempt: (
      action: string,
      input: unknown,
      options?: unknown,
    ) => Promise<{ ok: boolean; error?: { code: string } }>;
  };

/**
 * The operator opens a thread of `ownerId` and asks for a delivery to it, under command ids of its
 * own.
 */
async function plant(booted: Awaited<ReturnType<typeof bootErasureRules>>, ownerId: string) {
  const operator = loose(booted.operator);
  const { threadId } = (await operator.invoke(
    'probe.open',
    { ownerId, title: 'a thread' },
    { commandId: opened },
  )) as { threadId: string };
  await operator.invoke(
    'probe.send',
    { threadId, to: 'plain.recipient@example.test' },
    { commandId: sent },
  );
  return threadId;
}

const erase = (booted: Awaited<ReturnType<typeof bootErasureRules>>, subjectId: string) =>
  loose(booted.operator).invoke(
    'core.eraseSubject',
    { subjectId, reason: 'operator' },
    { prefer: 'async' },
  );

describe('the receipts of commands that touched the erased subject (14.7.5, WP-130)', () => {
  test("an erasure scrubs the fingerprint of another principal's command that wrote in the subject's stream", {
    timeout,
  }, async () => {
    const booted = await bootErasureRules();
    const { runtime, worker, subject } = booted;
    await plant(booted, subject);
    expect(await fingerprintOf(runtime, opened)).toMatch(keyedFingerprint);
    await erase(booted, subject);
    await runtime.drainJobs();
    await worker.pass();
    expect(await fingerprintOf(runtime, opened)).toBe('erased');
  });

  test('... that requested an effect of the subject', { timeout }, async () => {
    const booted = await bootErasureRules();
    const { runtime, worker, subject } = booted;
    await plant(booted, subject);
    expect(await fingerprintOf(runtime, sent)).toMatch(keyedFingerprint);
    await erase(booted, subject);
    await runtime.drainJobs();
    await worker.pass();
    expect(await fingerprintOf(runtime, sent)).toBe('erased');
  });

  test('a retry of that command answers core.idempotency_mismatch', { timeout }, async () => {
    const booted = await bootErasureRules();
    const { runtime, worker, subject } = booted;
    const operator = loose(booted.operator);
    await plant(booted, subject);
    await erase(booted, subject);
    await runtime.drainJobs();
    await worker.pass();
    const retry = await operator.attempt(
      'probe.open',
      { ownerId: subject, title: 'a thread' },
      { commandId: opened },
    );
    expect(retry.ok).toBe(false);
    expect(retry.error?.code).toBe('core.idempotency_mismatch');
  });

  test('the receipt of a command that touched no stream of the subject keeps its fingerprint', {
    timeout,
  }, async () => {
    const booted = await bootErasureRules();
    const { runtime, worker, subject } = booted;
    const operator = loose(booted.operator);
    await plant(booted, subject);
    await operator.invoke(
      'probe.open',
      { ownerId: crypto.randomUUID(), title: 'another thread' },
      { commandId: elsewhere },
    );
    await erase(booted, subject);
    await runtime.drainJobs();
    await worker.pass();
    expect(await fingerprintOf(runtime, elsewhere)).toMatch(keyedFingerprint);
  });

  test('a second run scrubs nothing', { timeout }, async () => {
    const booted = await bootErasureRules();
    const { runtime, worker, subject } = booted;
    await plant(booted, subject);
    await erase(booted, subject);
    await runtime.drainJobs();
    await worker.pass();
    const again = await runtime.adapter.unit(runtime.namespace, scopeOf(runtime), (unit) =>
      scrubReceiptFingerprints(unit, runtime.app.registry, [opened, sent, elsewhere]),
    );
    expect(again).toBe(0);
  });
});
