import { erasure } from '@keelwerk/events';
import { describe, expect, test } from 'vitest';
import { startTestRuntime } from '../../src/harness/start-test-runtime.ts';
import { dumpDatabase, findPlaintext } from '../../src/index.ts';
import { erasureDumpApp } from './support/erasure-probe-module.ts';
import { memorySink } from './support/memory-sink.ts';
import { openReferenceLock, waitForReferenceLock } from './support/reference-lock.ts';
import { scopeOf, useRestartDatabase } from './support/restart-kit.ts';

describe('erasure across restarts on PostgreSQL (14.7.5 steps 1 to 6, 14.7.6)', () => {
  const { stops, external, dispatcher, owner, seedAda, inTenant, personRows, joined } =
    useRestartDatabase();

  test('a crash after the ledger record is repaired by the start pass of a new runtime', {
    timeout: 240_000,
  }, async () => {
    const sink = memorySink();
    const crashing = erasure({
      pollMs: 3_600_000,
      afterStep: async (step) => {
        if (step === 'ledger') throw new Error('crash after the ledger record');
      },
    });
    const first = await startTestRuntime(erasureDumpApp, {
      external: external(),
      operators: true,
      workers: true,
      ledgers: [sink],
      eventWorkers: [dispatcher(), crashing],
    });
    stops.push(() => first.stop());
    const { operator, ada } = await seedAda(first);
    const accepted = await operator.invoke(
      'core.eraseSubject',
      { subjectId: ada as never, reason: 'subjectRequest' },
      { prefer: 'async' },
    );
    const commandId = String((accepted as { commandId: string }).commandId);
    await first.drainJobs();
    await crashing.pass();
    // The record reached the ledger and the sink; the erasure itself did not run.
    expect(sink.records.some((record) => record.type === 'erasure')).toBe(true);
    expect((await inTenant(first, (unit) => unit.receipts.get(commandId)))?.status).toBe(
      'accepted',
    );
    expect((await personRows(first)).map((row) => row.id)).toEqual([ada]);
    await first.stop();

    // A new runtime on the same database: its start pass finishes the erasure.
    const second = await startTestRuntime(erasureDumpApp, {
      external: external(),
      operators: true,
      workers: true,
      ledgers: [sink],
      join: joined(first),
      eventWorkers: [dispatcher(), erasure({ pollMs: 3_600_000 })],
    });
    stops.push(() => second.stop());
    expect((await inTenant(second, (unit) => unit.receipts.get(commandId)))?.status).toBe(
      'completed',
    );
    expect(await personRows(second)).toEqual([]);
  });

  test('a unit that read the subject key holds the shred back, its committed value is cleared by the erasure, and a write after the shred is forbidden', {
    timeout: 240_000,
  }, async () => {
    const worker = erasure({ pollMs: 3_600_000 });
    const runtime = await startTestRuntime(erasureDumpApp, {
      external: external(),
      operators: true,
      workers: true,
      eventWorkers: [dispatcher(), worker],
    });
    stops.push(() => runtime.stop());
    const { operator, ada } = await seedAda(runtime);
    const bea = String(
      (
        (await operator.invoke('probe.enrol', {
          name: 'Bea',
          email: 'restart.bea@example.test',
        })) as {
          personId: string;
        }
      ).personId,
    );
    const thread = String(
      (
        (await operator.invoke('probe.open', { ownerId: bea as never, title: 'b' })) as {
          threadId: string;
        }
      ).threadId,
    );
    const threadEntry = runtime.app.registry.entities.get('probe.thread');
    if (threadEntry === undefined) throw new Error('no probe.thread');
    const marker = 'a value the held unit commits under the subject';
    const threadRow = () =>
      inTenant(runtime, async (unit) =>
        unit.rows.findOne(threadEntry.descriptor, {
          where: { op: 'eq', field: 'id', value: thread },
          includeArchived: true,
        }),
      );

    // The held write is a real command: it reads the subject's key `for share`, seals the marker
    // under it, and then waits for the reference row `kw_subject_refs` that an open transaction of
    // the test has inserted but not committed. The command holds the key until that transaction ends.
    const client = await owner();
    await openReferenceLock(client, {
      tenantId: runtime.tenants.acme?.id ?? '',
      subject: ada,
      thread,
    });
    const writer = operator.invoke('probe.answer', {
      threadId: thread as never,
      replierId: ada as never,
      reply: marker,
    });
    await waitForReferenceLock(client);

    await operator.invoke(
      'core.eraseSubject',
      { subjectId: ada as never, reason: 'subjectRequest' },
      { prefer: 'async' },
    );
    await runtime.drainJobs();
    let finished = false;
    const erasing = worker.pass().then(() => {
      finished = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 1000));
    // The shred waits for the held command: the erasure has not finished, the command has not either.
    expect(finished).toBe(false);
    await client.query('commit');
    await writer;
    await erasing;

    // What the held unit committed is cleared by the erasure, and the marker is nowhere.
    expect((await threadRow())?.reply).toBeUndefined();
    // The column itself is cleared, not only unreadable: the raw row holds no ciphertext either.
    const raw = await runtime.adapter.unit(runtime.namespace, scopeOf(runtime), (unit) =>
      unit.rows.findOne(threadEntry.descriptor, {
        where: { op: 'eq', field: 'id', value: thread },
        includeArchived: true,
      }),
    );
    expect(raw?.reply ?? null).toBeNull();
    const dump = await dumpDatabase(async (sql) => (await client.query(sql)).rows);
    expect(findPlaintext(dump, [marker])).toEqual([]);
    expect(
      await inTenant(runtime, (unit) => unit.keys.dataKey(ada, { create: false })),
    ).toBeUndefined();

    // A write that starts after the shred cannot seal under the destroyed key.
    const outcome = await operator.attempt('probe.answer', {
      threadId: thread as never,
      replierId: ada as never,
      reply: 'a value that must not come back',
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error).toMatchObject({ kind: 'forbidden' });
  });
});
