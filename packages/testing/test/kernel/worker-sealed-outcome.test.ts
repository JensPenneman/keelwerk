import type { Unit } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import { findPlaintext } from '../../src/dump/find-plaintext.ts';
import { startTestRuntime } from '../../src/harness/start-test-runtime.ts';
import { testCarrier } from '../../src/harness/test-carrier.ts';
import { testPrincipal } from '../../src/harness/test-principal.ts';
import { courierApp } from './support/courier-kit.ts';

const secretValue = 'plain-api-key-1';

/** Everything a value holds as text, bytes as hex and big integers as decimals. */
const dump = (value: unknown): string =>
  JSON.stringify(value, (_key, member: unknown) =>
    member instanceof Uint8Array
      ? Buffer.from(member).toString('hex')
      : typeof member === 'bigint'
        ? member.toString()
        : member,
  );

describe.each(['memory', 'pglite'] as const)(
  'an async command with a secret output on %s (S-127, S-145)',
  (kind) => {
    test('the worker stores the sealed outcome, in the receipt and in its change record', {
      timeout: 90_000,
    }, async () => {
      const runtime = await startTestRuntime(courierApp, { adapter: kind, workers: true });
      const tenant = runtime.tenants.acme;
      const scope = { level: 'tenant', backendId: runtime.backendId, tenantId: tenant.id } as const;
      const commandId = crypto.randomUUID();
      const ask = (prefer: 'async' | 'sync') =>
        runtime.invoker.invoke<unknown, { apiKey: string }>({
          action: 'courier.issue',
          input: {},
          carrier: testCarrier(tenant, testPrincipal('ada')),
          requestId: crypto.randomUUID(),
          commandId,
          prefer,
          signal: new AbortController().signal,
        });

      const accepted = await ask('async');
      expect(accepted.ok).toBe(true);
      expect(await runtime.drainJobs()).toBeGreaterThanOrEqual(1);

      const stored = await runtime.adapter.unit(runtime.namespace, scope, async (unit: Unit) => ({
        receipt: await unit.receipts.get(commandId),
        events: (await unit.events.readAll(null, { limit: 100, includeTransient: true })).events,
      }));
      expect(stored.receipt?.status).toBe('completed');
      expect(
        stored.events.filter((event) => event.stream.type === 'core.commandReceipt'),
      ).toHaveLength(2);
      const text = dump(stored);
      expect(text).toMatch(/kwv1\./);
      expect(findPlaintext(text, [secretValue])).toEqual([]);

      // The submitter still reads the value, through the receipt.
      const replayed = await ask('sync');
      expect(replayed).toMatchObject({ ok: true, value: { apiKey: secretValue } });
      await runtime.stop();
    });
  },
);

describe.each(['memory', 'pglite'] as const)(
  'an async command with a secret input on %s (S-127)',
  (kind) => {
    const token = 'plain-token-for-the-job-1';

    test('the job row holds the secret sealed while it waits, and the worker runs with the plaintext', {
      timeout: 90_000,
    }, async () => {
      // Only a queue nobody names is worked, so the accepted command's job waits in `kw_jobs`.
      const waiting = await startTestRuntime(courierApp, {
        adapter: kind,
        workers: { queues: ['held'] },
      });
      const tenant = waiting.tenants.acme;
      const scope = { level: 'tenant', backendId: waiting.backendId, tenantId: tenant.id } as const;
      const ask = (runtime: typeof waiting, commandId: string) =>
        runtime.invoker.invoke<unknown, { length: number }>({
          action: 'courier.lodge',
          input: { token },
          carrier: testCarrier(runtime.tenants.acme, testPrincipal('ada')),
          requestId: crypto.randomUUID(),
          commandId,
          prefer: 'async',
          signal: new AbortController().signal,
        });
      expect((await ask(waiting, crypto.randomUUID())).ok).toBe(true);
      const jobs = await waiting.adapter.unit(
        waiting.namespace,
        scope,
        async (unit: Unit) =>
          (
            await unit.jobs.take('commands', 'dump', {
              limit: 10,
              capabilitySets: [''],
              maxRevision: 1000,
              leaseMs: 1000,
            })
          ).jobs,
      );
      expect(jobs).toHaveLength(1);
      const text = dump(jobs);
      expect(text).toMatch(/kwv1\./);
      expect(findPlaintext(text, [token])).toEqual([]);
      await waiting.stop();

      const running = await startTestRuntime(courierApp, { adapter: kind, workers: true });
      const commandId = crypto.randomUUID();
      expect((await ask(running, commandId)).ok).toBe(true);
      expect(await running.drainJobs()).toBeGreaterThanOrEqual(1);
      const receipt = await running.adapter.unit(
        running.namespace,
        { level: 'tenant', backendId: running.backendId, tenantId: running.tenants.acme.id },
        (unit: Unit) => unit.receipts.get(commandId),
      );
      // The command saw the plaintext: a sealed text would have another length.
      expect(receipt).toMatchObject({
        status: 'completed',
        outcome: { ok: true, value: { length: token.length } },
      });
      await running.stop();
    });
  },
);
