import { erasure } from '@keelwerk/events';
import { expect, test, vi } from 'vitest';
import { createLocalClient } from '../../src/harness/create-local-client.ts';
import { startTestRuntime } from '../../src/harness/start-test-runtime.ts';
import { testOperator } from '../../src/harness/test-operator.ts';
import { pgliteQuery } from './support/dump-sections.ts';
import { dumpDispatcher } from './support/erasure-dump-markers.ts';
import { rowsOf } from './support/erasure-dump-tools.ts';
import { erasureDumpApp } from './support/erasure-probe-module.ts';
import { dumpTime } from './support/erasure-usage-flush.ts';
import { kernelRows } from './support/restart-kit.ts';

const bucket = 'serial partition plain bucket';

test('the per values of a counter, a plain field and a reference, stay in kw_serials and in the marks after an erasure', {
  timeout: 240_000,
}, async () => {
  const time = dumpTime();
  const worker = erasure({ pollMs: 3_600_000 });
  const runtime = await startTestRuntime(erasureDumpApp, {
    adapter: 'pglite',
    operators: true,
    clock: time.clock,
    timers: time.timers,
    workers: true,
    eventWorkers: [dumpDispatcher(), worker],
  });
  try {
    const queries = [pgliteQuery(runtime.adapter), pgliteQuery(runtime.control.adapter)];
    const operator = createLocalClient(runtime, { principal: testOperator(), tenant: 'acme' });
    const enrol = async (name: string, email: string): Promise<string> =>
      String(
        ((await operator.invoke('probe.enrol', { name, email })) as { personId: string }).personId,
      );
    const ada = await enrol('Ada', 'serial.ada@example.test');
    const thread = String(
      (
        (await operator.invoke('probe.open', { ownerId: ada as never, title: 'a' })) as {
          threadId: string;
        }
      ).threadId,
    );
    // No command allocates a serial yet: the counters are planted in a unit of the tenant.
    const descriptor = runtime.app.registry.entities.get('probe.counted')?.descriptor;
    if (descriptor === undefined) throw new Error('no probe.counted');
    const scope = {
      level: 'tenant',
      backendId: runtime.backendId,
      tenantId: runtime.tenants.acme.id,
    } as const;
    await runtime.sealed.unit(runtime.namespace, scope, async (unit) => {
      await unit.serials.next(descriptor, 'inBucket', [bucket]);
      await unit.serials.next(descriptor, 'inThread', [thread]);
    });

    expect(
      await operator.invoke(
        'core.eraseSubject',
        { subjectId: ada as never, reason: 'subjectRequest' },
        { prefer: 'async' },
      ),
    ).toMatchObject({ status: 'accepted' });
    await runtime.drainJobs();
    await worker.pass();
    await runtime.drainJobs();
    // The erasure ran: the thread of the erased subject is erased.
    expect(
      (await kernelRows(runtime, 'probe.thread')).find((row) => row.id === thread)?.kwErasedAt,
    ).toBeDefined();

    // The marks service records the counters at its next minute.
    time.advance(61_000);
    await time.timers.fire();
    const textOf = async (table: string): Promise<string> =>
      JSON.stringify(await rowsOf(queries, table));
    await vi.waitFor(async () => expect(await textOf('kw_scope_marks')).toContain(bucket));

    // Both values are in the counters and in the marks, as the inventory says: no erasure walk
    // reaches them, and nothing checks that a plain field's value is opaque. The thread belongs
    // to the erased subject, so its id staying here is what the erasure leaves behind.
    for (const table of ['kw_serials', 'kw_scope_marks']) {
      const text = await textOf(table);
      expect(text, `${table} holds the plain field value`).toContain(bucket);
      expect(text, `${table} holds the id of the row the reference names`).toContain(thread);
    }
  } finally {
    await runtime.stop();
  }
});
