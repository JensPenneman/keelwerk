import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, test } from 'vitest';
import { createLocalClient } from '../../src/harness/create-local-client.ts';
import { startTestRuntime } from '../../src/harness/start-test-runtime.ts';
import { testOperator } from '../../src/harness/test-operator.ts';
import type { TestRuntime } from '../../src/harness/test-runtime.ts';
import { pgliteQuery } from './support/dump-sections.ts';
import { dumpAll, plainFingerprint, rowsOf } from './support/erasure-dump-tools.ts';
import { fingerprintAtRestApp, restScopeOf } from './support/fingerprint-at-rest-app.ts';

type Runtime = TestRuntime<typeof fingerprintAtRestApp>;
type Answer = { ok: boolean; value?: unknown; error?: { code: string } };

const runtimes: Runtime[] = [];
afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.stop()));
});

const receiptForm = /^kwf1\.[0-9a-f]{64}$/;
const decisionForm = /^kw[bd]1\.[0-9a-f]{64}$/;

interface Planted {
  readonly action: string;
  readonly input: Record<string, unknown>;
  readonly commandId: string;
}

/** Every secret the planted commands carry. */
const secrets = [
  'hunter2-4711',
  'wrong-4711',
  'later-secret-4711',
  'nested-secret-4711',
  'timer-secret-4711',
  'effect-secret-4711',
  'pin-4711',
  'pin-update-4711',
];

async function boot(adapter: 'memory' | 'pglite') {
  const runtime = await startTestRuntime(fingerprintAtRestApp, {
    adapter,
    operators: true,
    workers: true,
  });
  runtimes.push(runtime);
  const client = createLocalClient(runtime, { principal: testOperator(), tenant: 'acme' });
  const attempt = (
    action: string,
    input: Record<string, unknown>,
    commandId: string,
    prefer?: 'async',
  ) =>
    (
      client as unknown as {
        attempt: (action: string, input: unknown, options: unknown) => Promise<Answer>;
      }
    ).attempt(action, input, { commandId, ...(prefer === undefined ? {} : { prefer }) });
  return { runtime, attempt };
}

/**
 * Runs one command of every path; the refused one carries a client id, so its failure is recorded.
 */
async function plant(booted: Awaited<ReturnType<typeof boot>>): Promise<readonly Planted[]> {
  const { runtime, attempt } = booted;
  const planted: Planted[] = [];
  const run = async (
    action: string,
    input: Record<string, unknown>,
    options: { readonly prefer?: 'async' } = {},
  ): Promise<Answer> => {
    const commandId = randomUUID();
    planted.push({ action, input, commandId });
    return attempt(action, input, commandId, options.prefer);
  };
  expect(await run('rest.sign', { label: 'a', password: secrets[0] })).toMatchObject({ ok: true });
  expect(await run('rest.plain', { label: 'plain' })).toMatchObject({ ok: true });
  expect(await run('rest.guard', { password: secrets[1] })).toMatchObject({
    ok: false,
    error: { code: 'rest.wrong_password' },
  });
  expect(
    await run('rest.later', { label: 'l', password: secrets[2] }, { prefer: 'async' }),
  ).toMatchObject({ ok: true });
  await runtime.drainJobs();
  expect(await run('rest.nest', { label: 'n' })).toMatchObject({ ok: true });
  expect(await run('rest.arm', { label: 't' })).toMatchObject({ ok: true });
  expect(await run('rest.dispatch', { to: 'somewhere' })).toMatchObject({ ok: true });
  const created = await run('rest.item.create', { name: 'Ada', notes: 'n', pin: secrets[6] });
  expect(created).toMatchObject({ ok: true });
  const id = String((created.value as { id: unknown }).id);
  expect(await run('rest.item.update', { id, patch: { pin: secrets[7] } })).toMatchObject({
    ok: true,
  });
  await runtime.drainJobs();
  return planted;
}

/** The decision digests of the command decisions in the events, by the action that wrote them. */
const commandDigestsOf = (
  events: readonly { readonly action?: string | null; readonly decision: unknown }[],
): readonly string[] =>
  events
    .filter((event) => {
      const decision = event.decision as { readonly part?: string } | null;
      return decision !== null && decision.part === event.action;
    })
    .map((event) => (event.decision as { readonly inputDigest: string }).inputDigest);

describe('no stored digest is plain and none holds a secret (WP-158)', () => {
  test('memory: every receipt and every command decision of the planted commands is keyed', {
    timeout: 60_000,
  }, async () => {
    const booted = await boot('memory');
    const planted = await plant(booted);
    const { runtime } = booted;
    const stored = await runtime.adapter.unit(
      runtime.namespace,
      restScopeOf(runtime),
      async (unit) => ({
        receipts: await Promise.all(planted.map((one) => unit.receipts.get(one.commandId))),
        events: (await unit.events.readAll(null, { limit: 1000 })).events,
      }),
      { readOnly: true },
    );
    for (const receipt of stored.receipts) expect(receipt?.fingerprint).toMatch(receiptForm);
    const digests = commandDigestsOf(stored.events);
    expect(digests.length).toBeGreaterThan(0);
    for (const digest of digests) expect(digest).toMatch(decisionForm);
    const fingerprints = new Set(stored.receipts.map((receipt) => receipt?.fingerprint));
    for (const digest of digests) expect(fingerprints.has(digest)).toBe(false);
  });

  test('PGlite: the dump holds no secret and no plain digest, and no meta holds a receipt fingerprint', {
    timeout: 120_000,
  }, async () => {
    const booted = await boot('pglite');
    const planted = await plant(booted);
    const { runtime } = booted;
    const queries = [pgliteQuery(runtime.adapter), pgliteQuery(runtime.control.adapter)];
    const receipts = await rowsOf(queries, 'core__command_receipt');
    expect(receipts.length).toBeGreaterThan(planted.length);
    for (const row of receipts) {
      expect(String(row.fingerprint), 'every receipt, the control store included').toMatch(
        receiptForm,
      );
    }
    const events = (await rowsOf(queries, 'kw_events')).map((row) => {
      const meta = (typeof row.meta === 'string' ? JSON.parse(row.meta) : row.meta) as {
        readonly action?: string;
        readonly decision: unknown;
      };
      return { action: meta.action ?? null, decision: meta.decision };
    });
    const digests = commandDigestsOf(events);
    expect(digests.length).toBeGreaterThan(0);
    for (const digest of digests) expect(digest).toMatch(decisionForm);
    const text = await dumpAll(queries);
    for (const row of receipts) {
      const fingerprint = String(row.fingerprint);
      for (const digest of digests) expect(digest).not.toBe(fingerprint);
      const metas = JSON.stringify(events);
      expect(metas).not.toContain(fingerprint);
      expect(metas).not.toContain(fingerprint.slice('kwf1.'.length));
    }
    for (const secret of secrets)
      expect(text, `${secret} is not in the dump`).not.toContain(secret);
    for (const one of planted) {
      const plain = plainFingerprint(one.action, runtime.head, one.input);
      expect(text, `the 0.1.0 digest of ${one.action} is not in the dump`).not.toContain(plain);
    }
  });
});

describe.each(['memory', 'pglite'] as const)('a retry on %s (WP-158)', (kind) => {
  test('another personal value is core.idempotency_mismatch, another secret replays', {
    timeout: 120_000,
  }, async () => {
    const { attempt } = await boot(kind);
    const commandId = randomUUID();
    const first = { subjectId: randomUUID(), nickname: 'ada', password: 'hunter2-4711' };
    expect(await attempt('rest.register', first, commandId)).toMatchObject({ ok: true });
    expect(
      await attempt('rest.register', { ...first, password: 'another-4711' }, commandId),
    ).toMatchObject({ ok: true });
    expect(await attempt('rest.register', { ...first, nickname: 'bea' }, commandId)).toMatchObject({
      ok: false,
      error: { code: 'core.idempotency_mismatch' },
    });
  });

  test('a refused command is recorded under its id: the same id with another password answers the recorded failure', {
    timeout: 120_000,
  }, async () => {
    const { attempt } = await boot(kind);
    const commandId = randomUUID();
    expect(await attempt('rest.guard', { password: 'wrong-4711' }, commandId)).toMatchObject({
      ok: false,
      error: { code: 'rest.wrong_password' },
    });
    expect(await attempt('rest.guard', { password: 'other-4711' }, commandId)).toMatchObject({
      ok: false,
      error: { code: 'rest.wrong_password' },
    });
  });
});

describe('a dry run digests as a real run (WP-158)', () => {
  test('its inputDigest starts kwb1. and is the one a real run of the same input stores', {
    timeout: 60_000,
  }, async () => {
    const { runtime, attempt } = await boot('memory');
    const input = { label: 'dry', password: 'hunter2-4711' };
    // The scope key exists once the scope has written: a dry run of a scope without one digests
    // under a key of its own.
    await attempt('rest.plain', { label: 'first' }, randomUUID());
    const tenant = runtime.tenants.acme.id;
    const answer = await runtime.invoker.invoke({
      action: 'core.explain',
      input: { mode: 'dry-run', ref: 'rest.record', backend: runtime.backendId, tenant, input },
      carrier: { transport: 'cli', headers: { 'x-tenant': tenant }, local: { inProcess: true } },
      requestId: randomUUID(),
      signal: new AbortController().signal,
    });
    expect(answer.ok).toBe(true);
    const report = (answer as { value: { report: { decision?: { inputDigest: string } } } }).value
      .report;
    const commandId = randomUUID();
    expect(await attempt('rest.record', input, commandId)).toMatchObject({ ok: true });
    const stored = await runtime.adapter.unit(
      runtime.namespace,
      restScopeOf(runtime),
      async (unit) => (await unit.events.readAll(null, { limit: 100 })).events,
      { readOnly: true },
    );
    const real = stored.find((event) => event.commandId === commandId)?.decision?.inputDigest;
    expect(report.decision?.inputDigest).toMatch(/^kwb1\.[0-9a-f]{64}$/);
    expect(report.decision?.inputDigest).toBe(real);
  });
});
