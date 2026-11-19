import { consumers, reactionDispatcher, retention } from '@keelwerk/events';
import { afterEach, expect, test } from 'vitest';
import { createLocalClient } from '../../src/harness/create-local-client.ts';
import { startTestRuntime } from '../../src/harness/start-test-runtime.ts';
import { testOperator } from '../../src/harness/test-operator.ts';
import { testPrincipal } from '../../src/harness/test-principal.ts';
import type { TestRuntime } from '../../src/harness/test-runtime.ts';
import { erasureDumpApp } from './support/erasure-probe-module.ts';

const dispatcher = () => consumers({ consumers: [reactionDispatcher()], runs: ['asyncReactions'] });

let runtime: TestRuntime<typeof erasureDumpApp, 'acme'> | undefined;
afterEach(async () => {
  await runtime?.stop();
  runtime = undefined;
});

test.each(['memory', 'pglite'] as const)(
  'a ticket a day past its expiry is gone after a run, a fresh one stays, on %s',
  { timeout: 60_000 },
  async (kind) => {
    const worker = retention({ intervalMs: 3_600_000 });
    const booted = await startTestRuntime(erasureDumpApp, {
      adapter: kind,
      tenants: ['acme'],
      operators: true,
      workers: true,
      eventWorkers: [dispatcher(), worker],
    });
    runtime = booted;
    const operator = createLocalClient(booted, { principal: testOperator(), tenant: 'acme' });
    const ada = String(
      (
        (await operator.invoke('probe.enrol', {
          name: 'Ada',
          email: 'ticket.ada@example.test',
        })) as {
          personId: string;
        }
      ).personId,
    );
    const session = String(
      ((await operator.invoke('probe.signIn', { ownerId: ada as never })) as { sessionId: string })
        .sessionId,
    );
    const user = createLocalClient(booted, {
      principal: testPrincipal(ada, { principalId: session }),
      tenant: 'acme',
    });
    const scope = {
      level: 'tenant',
      backendId: booted.backendId,
      tenantId: booted.tenants.acme.id,
    } as const;
    const tickets = async (): Promise<number> => {
      const descriptor = booted.app.registry.entities.get('live.streamTicket')?.descriptor;
      if (descriptor === undefined) throw new Error('no live.streamTicket');
      return (
        await booted.sealed.unit(booted.namespace, scope, (unit) =>
          unit.rows.find(descriptor, { includeArchived: true }),
        )
      ).rows.length;
    };
    await user.invoke('live.ticket', {});
    expect(await tickets()).toBe(1);
    // A ticket lives for a minute: a pass now keeps it, and a day and a minute later it is gone.
    await worker.pass();
    expect(await tickets()).toBe(1);
    await booted.advanceTo(booted.clock.now().add({ hours: 24, minutes: 2 }));
    await user.invoke('live.ticket', {});
    expect(await tickets()).toBe(2);
    const runs = await worker.pass();
    expect(await tickets()).toBe(1);
    expect(runs.reduce((sum, run) => sum + (run.removed.streamTickets ?? 0), 0)).toBe(1);
  },
);
