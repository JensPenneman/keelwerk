import { randomUUID } from 'node:crypto';
import type { PrincipalRef, StoredJobSpec } from '@keelwerk/core';
import { afterEach, describe, expect, test } from 'vitest';
import { createLocalClient } from '../../src/harness/create-local-client.ts';
import { startTestRuntime } from '../../src/harness/start-test-runtime.ts';
import { testOperator } from '../../src/harness/test-operator.ts';
import type { TestRuntime } from '../../src/harness/test-runtime.ts';
import { plainFingerprint } from './support/erasure-dump-tools.ts';
import { fingerprintAtRestApp, restScopeOf } from './support/fingerprint-at-rest-app.ts';

type Runtime = TestRuntime<typeof fingerprintAtRestApp>;
type Answer = { ok: boolean; error?: { code: string } };

const runtimes: Runtime[] = [];
afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.stop()));
});

async function boot(adapter: 'memory' | 'pglite') {
  const runtime = await startTestRuntime(fingerprintAtRestApp, {
    adapter,
    operators: true,
    workers: true,
  });
  runtimes.push(runtime);
  const client = createLocalClient(runtime, { principal: testOperator(), tenant: 'acme' });
  const attempt = (action: string, input: unknown, commandId: string, prefer?: 'async') =>
    (
      client as unknown as {
        attempt: (action: string, input: unknown, options: unknown) => Promise<Answer>;
      }
    ).attempt(action, input, { commandId, ...(prefer === undefined ? {} : { prefer }) });
  const receiptOf = (commandId: string) =>
    runtime.adapter.unit(
      runtime.namespace,
      restScopeOf(runtime),
      (unit) => unit.receipts.get(commandId),
      { readOnly: true },
    );
  /**
   * Plants a receipt as 0.1.0 wrote it under `commandId`: the stored receipt of `template` (a
   * command of the same principal) with the plain SHA-256 of the canonical input as its
   * fingerprint.
   */
  const plantLegacy = async (
    template: string,
    commandId: string,
    action: string,
    input: unknown,
  ) => {
    const stored = await receiptOf(template);
    if (stored === undefined) throw new Error('the template receipt is missing');
    const legacy = plainFingerprint(action, stored.apiVersion, input);
    await runtime.adapter.unit(runtime.namespace, restScopeOf(runtime), (unit) =>
      unit.receipts.put({ ...stored, commandId, fingerprint: legacy }),
    );
    return legacy;
  };
  return { runtime, attempt, receiptOf, plantLegacy };
}

describe.each(['memory', 'pglite'] as const)(
  'a receipt written by 0.1.0 on %s (WP-158)',
  (kind) => {
    test('a completed receipt in its window replays for the same input and refuses another password', {
      timeout: 120_000,
    }, async () => {
      const { attempt, receiptOf, plantLegacy } = await boot(kind);
      const template = randomUUID();
      const commandId = randomUUID();
      const input = { label: 'a', password: 'hunter2-4711' };
      expect(await attempt('rest.sign', input, template)).toMatchObject({ ok: true });
      const legacy = await plantLegacy(template, commandId, 'rest.sign', input);
      expect((await receiptOf(commandId))?.fingerprint).toBe(legacy);
      expect(await attempt('rest.sign', input, commandId)).toMatchObject({ ok: true });
      expect(
        await attempt('rest.sign', { ...input, password: 'another-4711' }, commandId),
      ).toMatchObject({ ok: false, error: { code: 'core.idempotency_mismatch' } });
      expect(await attempt('rest.sign', { ...input, label: 'b' }, commandId)).toMatchObject({
        ok: false,
        error: { code: 'core.idempotency_mismatch' },
      });
      // The receipt is the one 0.1.0 wrote: nothing rewrote it.
      expect((await receiptOf(commandId))?.fingerprint).toBe(legacy);
    });

    test('an accepted receipt of 0.1.0 is completed by the worker that runs its sealed job', {
      timeout: 120_000,
    }, async () => {
      const { runtime, attempt, receiptOf, plantLegacy } = await boot(kind);
      const template = randomUUID();
      const commandId = randomUUID();
      const input = { label: 'l', password: 'later-secret-4711' };
      expect(await attempt('rest.later', input, template, 'async')).toMatchObject({ ok: true });
      expect((await receiptOf(template))?.status).toBe('accepted');
      const legacy = await plantLegacy(template, commandId, 'rest.later', input);
      expect((await receiptOf(commandId))?.status).toBe('accepted');
      // A job that names the command id of the planted receipt: its worker takes the receipt over.
      expect(await attempt('rest.queue', { id: commandId, ...input }, randomUUID())).toMatchObject({
        ok: true,
      });
      await runtime.drainJobs();
      const completed = await receiptOf(commandId);
      expect(completed?.status).toBe('completed');
      expect(completed?.fingerprint).toBe(legacy);
    });
    test('an accepted receipt of 0.1.0 is completed by the worker that runs its unsealed job, and keeps its fingerprint', {
      timeout: 120_000,
    }, async () => {
      const { runtime, attempt, receiptOf, plantLegacy } = await boot(kind);
      const template = randomUUID();
      const commandId = randomUUID();
      const input = { label: 'l', password: 'later-secret-4711' };
      expect(await attempt('rest.later', input, template, 'async')).toMatchObject({ ok: true });
      // The template's own job is not what this case is about: the worker takes it as well.
      const legacy = await plantLegacy(template, commandId, 'rest.later', input);
      const planted = await receiptOf(commandId);
      expect(planted?.status).toBe('accepted');
      // The job of 0.1.0: the input as sent, the password in clear, not sealed.
      const spec: StoredJobSpec = {
        kind: 'action',
        queue: 'commands',
        run: { action: 'rest.later', input, commandId },
        scope: restScopeOf(runtime) as StoredJobSpec['scope'],
        principal: planted?.principal as PrincipalRef,
        causation: { commandId },
        build: { id: 'test-build', revision: 1 },
        apiVersion: planted?.apiVersion ?? runtime.head,
        laneCap: 4,
        createdAt: runtime.clock.now(),
      };
      await runtime.adapter.unit(runtime.namespace, restScopeOf(runtime), (unit) =>
        unit.jobs.enqueue(spec),
      );
      await runtime.drainJobs();
      const completed = await receiptOf(commandId);
      expect(completed?.status).toBe('completed');
      expect(completed?.fingerprint).toBe(legacy);
    });
  },
);
