import type { StoredEvent } from '@keelwerk/core';
import { entityBehavioursOf } from '@keelwerk/core';
import { seedRows } from '@keelwerk/core/replay';
import { startTestRuntime } from '../harness/start-test-runtime.ts';
import type { TestApp } from '../harness/test-app.ts';
import { testCarrier } from '../harness/test-carrier.ts';
import { tenantAddress } from '../replay/tenant-address.ts';
import type { InMemoryRun } from './in-memory-run.ts';
import type { RunInMemoryOptions } from './run-in-memory-options.ts';

/**
 * Runs a command of the app on the in-memory adapter from given rows (section 7.9.6): the rows
 * are written as the events and state a command would have left, then the command goes through
 * the whole pipeline as the principal. The run keeps the runtime open so the decision can be
 * re-decided from its events; call `stop` when done.
 */
export async function runInMemory(
  app: TestApp,
  ref: string,
  options: RunInMemoryOptions,
): Promise<InMemoryRun> {
  const runtime = await startTestRuntime(app);
  try {
    const address = tenantAddress(runtime, options.tenant);
    const { tenant } = address;
    const entityOf = (entity: string) => {
      const found = app.registry.entities.get(entity);
      if (found === undefined) throw new Error(`${entity} is not an entity of the app`);
      return found.descriptor;
    };
    if (options.rows !== undefined) {
      const rows = options.rows;
      await runtime.sealed.unit(address.namespace, address.scope, (unit) =>
        seedRows({
          unit,
          registry: app.registry,
          behaviours: entityBehavioursOf(app.modules),
          rows,
          now: Temporal.Now.instant(),
        }),
      );
    }
    const commandId = options.commandId ?? crypto.randomUUID();
    const answer = await runtime.invoker.invoke({
      action: ref,
      input: options.input,
      carrier: testCarrier(
        tenant,
        options.principal ?? { subject: 'tester', roles: [], claims: {} },
      ),
      requestId: crypto.randomUUID(),
      signal: new AbortController().signal,
      commandId,
    });
    const events = await runtime.adapter.unit(address.namespace, address.scope, async (unit) => {
      const found: StoredEvent[] = [];
      let after: bigint | null = null;
      for (;;) {
        const batch = await unit.events.readAll(after, { limit: 500, includeTransient: true });
        found.push(...batch.events);
        if (batch.next === null || batch.events.length === 0) return found;
        after = batch.next;
      }
    });
    return {
      runtime,
      tenant: tenant.name,
      commandId,
      outcome: answer.ok ? { ok: true, value: answer.value } : { ok: false, error: answer.error },
      events,
      rows: (entity) =>
        runtime.sealed.unit(
          address.namespace,
          address.scope,
          async (unit) => (await unit.rows.find(entityOf(entity), {})).rows,
        ),
      stop: () => runtime.stop(),
    };
  } catch (error) {
    await runtime.stop();
    throw error;
  }
}
