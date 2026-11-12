import type { Unit } from '@keelwerk/core';
import { defineApiVersions, defineApp } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import { library, loans } from '../../src/fixtures/index.ts';
import { startTestRuntime } from '../../src/harness/start-test-runtime.ts';
import { testCarrier } from '../../src/harness/test-carrier.ts';
import { testPrincipal } from '../../src/harness/test-principal.ts';

const older = '2026-11-04';
const head = '2026-11-11';
const app = defineApp({
  id: 'lending',
  modules: [library, loans],
  api: defineApiVersions({
    [older]: { deprecated: { at: '2026-11-10', sunset: '2026-12-01' } },
    [head]: {},
  }),
});

describe('a job of a version retired meanwhile (section 18.5)', () => {
  test('an async command accepted the day before the retirement runs when drained after it', async () => {
    const runtime = await startTestRuntime(app, {
      workers: true,
      tenants: ['acme'],
      clock: { now: () => Temporal.Instant.from('2026-12-01T23:59:50Z') },
    });
    try {
      const tenant = runtime.tenants.acme;
      const carrier = testCarrier(tenant, testPrincipal('ada'));
      const commandId = crypto.randomUUID();
      const accepted = await runtime.invoker.invoke({
        action: 'loans.lend',
        input: { bookTitle: 'Dune', dueAt: Temporal.Instant.from('2027-01-01T00:00:00Z') },
        carrier: { ...carrier, headers: { ...carrier.headers, 'keelwerk-version': older } },
        requestId: crypto.randomUUID(),
        commandId,
        prefer: 'async',
        signal: new AbortController().signal,
      });
      expect(accepted).toMatchObject({ ok: true, receipt: { status: 'accepted' } });
      // The version is retired from the UTC midnight on: the worker meets it five seconds later.
      expect(
        await runtime.advanceTo(Temporal.Instant.from('2026-12-02T00:00:05Z')),
      ).toBeGreaterThan(0);
      const scope = { level: 'tenant', backendId: runtime.backendId, tenantId: tenant.id } as const;
      const receipt = await runtime.adapter.unit(runtime.namespace, scope, (unit: Unit) =>
        unit.receipts.get(commandId),
      );
      expect(receipt?.status).toBe('completed');
    } finally {
      await runtime.stop();
    }
  });
});
