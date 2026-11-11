import type { SubjectId } from '@keelwerk/core';
import { afterEach, describe, expect, test } from 'vitest';
import type { LoggedLine } from '../../src/harness/logged-line.ts';
import { recordingLogger } from '../../src/harness/recording-logger.ts';
import { type HookEndpoint, startHookEndpoint } from './support/hook-endpoint.ts';
import { type BootedHooks, bootHooks, probeInput } from './support/hooks-kit.ts';
import { attemptsOf, drainHooks, effectOf, rowsOf } from './support/hooks-reads.ts';

const start = Temporal.Instant.from('2026-03-01T08:00:00Z');
const hours = (count: number): Temporal.Instant => start.add({ hours: count });
const owner = crypto.randomUUID() as SubjectId;

const cleanup: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.allSettled(cleanup.splice(0).map((close) => close()));
});

async function boot(
  answer?: (index: number) => number | 'hang',
  over: { readonly capabilities?: readonly string[] } = {},
) {
  const endpoint: HookEndpoint = await startHookEndpoint(answer);
  const lines: LoggedLine[] = [];
  const hooks = await bootHooks({
    adapter: 'memory',
    endpoint: endpoint.url,
    clock: { now: () => start },
    logger: recordingLogger(lines),
    ...over,
  });
  cleanup.push(
    () => hooks.runtime.stop(),
    () => endpoint.close(),
  );
  return { ...hooks, endpoint, lines };
}

async function probe(
  booted: BootedHooks,
  mode: string,
  over: { readonly url?: string; readonly group?: string; readonly note?: string } = {},
): Promise<void> {
  await booted.client.invoke('probes.run', probeInput(owner, mode, over));
}

/** Moves the pinned clock to `at` and lets the workers finish what that makes due, continuations included. */
async function later(booted: BootedHooks, at: Temporal.Instant): Promise<void> {
  await booted.runtime.advanceTo(at);
  await drainHooks(booted);
}

/** The result the continuation recorded on the first target. */
async function resultOf(booted: BootedHooks, index = 0): Promise<unknown> {
  return (await rowsOf(booted, 'probes.target'))[index]?.result;
}

describe('the retries of an executor (7.9.5, 9.5.4)', () => {
  test('unavailable is retried with the same idempotency key and settles succeeded with attempts 2', async () => {
    const booted = await boot((index) => (index === 0 ? 503 : 200));
    await booted.client.invoke('hooks.notify', { payload: 'retry me' });
    await drainHooks(booted);
    expect((await effectOf(booted, 'hooks.post'))?.status).toBe('requested');
    await later(booted, hours(1));
    const effect = await effectOf(booted, 'hooks.post');
    expect(effect).toMatchObject({ status: 'succeeded', attempts: 2, output: { status: 200 } });
    const keys = booted.endpoint.requests.map((request) => request.headers['idempotency-key']);
    expect(keys).toEqual([String(effect?.id), String(effect?.id)]);
    expect((await rowsOf(booted, 'hooks.delivery'))[0]).toMatchObject({ status: 'delivered' });
  });

  test('a 4xx answered as output settles succeeded with the status', async () => {
    const booted = await boot(() => 404);
    await booted.client.invoke('hooks.notify', { payload: 'refused' });
    await drainHooks(booted);
    expect(await effectOf(booted, 'hooks.post')).toMatchObject({
      status: 'succeeded',
      attempts: 1,
      output: { status: 404 },
    });
    expect((await rowsOf(booted, 'hooks.delivery'))[0]).toMatchObject({
      status: 'failed',
      responseStatus: 404,
    });
  });

  test('a thrown validation settles failed at once with its code, and the continuation reads it', async () => {
    const booted = await boot();
    await probe(booted, 'validation');
    await drainHooks(booted);
    const effect = await effectOf(booted, 'probes.act');
    expect(effect).toMatchObject({
      status: 'failed',
      attempts: 1,
      error: { kind: 'validation', code: 'core.validation', retryable: false },
    });
    const read = String(await resultOf(booted));
    expect(read).toMatch(/^failed core\.validation: /);
    // The executor's own text quoted the personal note; neither the record nor the continuation has it.
    expect(JSON.stringify(effect)).not.toContain('ada@example.org');
    expect(read).not.toContain('ada@example.org');
  });

  test('a job without a retry policy gives up after three attempts', async () => {
    const booted = await boot();
    await probe(booted, 'unavailable');
    await drainHooks(booted);
    for (let step = 1; step <= 4; step += 1) await later(booted, hours(step));
    expect(await effectOf(booted, 'probes.act')).toMatchObject({
      status: 'failed',
      attempts: 3,
      error: { code: 'core.unavailable' },
    });
    expect(String(await resultOf(booted))).toMatch(/^failed core\.unavailable: /);
  });

  test('rate_limited waits retryAfter and blocks the group for its other jobs', async () => {
    const booted = await boot();
    await probe(booted, 'rate_limited', { group: 'shared' });
    await drainHooks(booted);
    await probe(booted, 'ok', { group: 'shared' });
    await drainHooks(booted);
    // Within the wait nothing in the group runs: neither the retry nor the job behind it.
    await later(booted, start.add({ seconds: 100 }));
    expect(await resultOf(booted, 0)).toBeUndefined();
    expect(await resultOf(booted, 1)).toBeUndefined();
    await later(booted, start.add({ seconds: 130 }));
    await drainHooks(booted);
    const effects = (await rowsOf(booted, 'core.effect')).filter(
      (row) => row.type === 'probes.act',
    );
    expect(effects.map((row) => [row.status, row.attempts]).sort()).toEqual([
      ['succeeded', 1],
      ['succeeded', 2],
    ]);
  });

  test('a process without smtp-out never takes the job; one that advertises it does', async () => {
    const without = await boot();
    await probe(without, 'smtp');
    await drainHooks(without);
    await later(without, hours(1));
    expect((await effectOf(without, 'probes.act'))?.status).toBe('requested');
    const advertising = await boot(undefined, { capabilities: ['smtp-out'] });
    await probe(advertising, 'smtp');
    await drainHooks(advertising);
    expect((await effectOf(advertising, 'probes.act'))?.status).toBe('succeeded');
  });

  test('each attempt records process, build, start, end and error, with no message', async () => {
    const booted = await boot((index) => (index === 0 ? 503 : 200));
    await booted.client.invoke('hooks.notify', { payload: 'records' });
    await drainHooks(booted);
    await later(booted, hours(1));
    const effect = await effectOf(booted, 'hooks.post');
    const records = await attemptsOf(booted, String(effect?.id));
    expect(records.map((record) => [record.attempt, 'endedAt' in record])).toEqual([
      [1, false],
      [1, true],
      [2, false],
      [2, true],
    ]);
    const [first, firstEnd, second, secondEnd] = records;
    expect(first).toMatchObject({ startedAt: start.toString() });
    expect(typeof first?.process).toBe('string');
    expect(typeof first?.build).toBe('string');
    expect(firstEnd).toMatchObject({ endedAt: start.toString(), startedAt: start.toString() });
    expect(Object.keys(firstEnd?.error as object).sort()).toEqual([
      'code',
      'kind',
      'requestId',
      'retryable',
    ]);
    expect(firstEnd?.error).toMatchObject({ kind: 'unavailable', code: 'core.unavailable' });
    expect(second).not.toHaveProperty('error');
    expect(secondEnd).not.toHaveProperty('error');
    expect(JSON.stringify(records)).not.toContain('The endpoint answered');
  });

  test('an output over 64 KiB settles failed with core.effect_output_too_large', async () => {
    const booted = await boot();
    await probe(booted, 'big');
    await drainHooks(booted);
    expect(await effectOf(booted, 'probes.act')).toMatchObject({
      status: 'failed',
      error: { kind: 'unsupported', code: 'core.effect_output_too_large' },
    });
  });

  test('ctx.blobs.read and write reject with not_implemented', async () => {
    const booted = await boot();
    await probe(booted, 'blobs');
    await drainHooks(booted);
    expect(await effectOf(booted, 'probes.act')).toMatchObject({
      status: 'succeeded',
      output: { text: 'core.not_implemented core.not_implemented' },
    });
  });

  test('ctx.egress.fetch answers status and text and logs the effect id', async () => {
    const booted = await boot(() => 200);
    await probe(booted, 'fetch', { url: booted.endpoint.url });
    await drainHooks(booted);
    const effect = await effectOf(booted, 'probes.act');
    expect(effect).toMatchObject({
      status: 'succeeded',
      output: { status: 200, text: 'answered 200' },
    });
    expect(booted.lines.find((line) => line.message === 'egress')?.fields).toMatchObject({
      effect: String(effect?.id),
      host: '127.0.0.1',
      status: 200,
    });
  });
});
