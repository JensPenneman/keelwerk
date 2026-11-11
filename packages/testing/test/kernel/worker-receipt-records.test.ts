import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, test } from 'vitest';
import { testOperator } from '../../src/harness/test-operator.ts';
import { acmeScope, askCloseAll, lendBook, startWatched } from './support/worker-kit.ts';

const golden = fileURLToPath(new URL('./golden/receipt-change-records.json', import.meta.url));

/** The stored format of the records, by command id: written once, final from then on (rule 10). */
function stored(): Record<string, unknown> {
  return JSON.parse(readFileSync(golden, 'utf8')) as Record<string, unknown>;
}

const { runtime, spy } = await startWatched({ workers: true });
afterAll(() => runtime.stop());

/**
 * The change records of the receipts in the tenant's log, as they are stored: every member of the
 * envelope except the ids, the position, the namespace and the clock readings.
 */
async function receiptRecords() {
  const page = await runtime.adapter.unit(runtime.namespace, acmeScope(runtime), (unit) =>
    unit.events.readAll(null, { limit: 100, includeTransient: true }),
  );
  return page.events
    .filter((event) => event.stream.type === 'core.commandReceipt')
    .map((event) => ({
      type: event.type,
      version: event.version,
      transient: event.transient,
      hash: event.hash,
      prevHash: event.prevHash,
      schemaVersion: event.schemaVersion,
      partition: event.partition,
      actor: event.actor,
      commandId: event.commandId,
      action: event.action,
      causationId: event.causationId,
      // Accepting an async command correlates by the request, which is a fresh id each time.
      correlationId:
        event.correlationId === event.commandId ? event.correlationId : 'the request id',
      client: event.client,
      merge: event.merge,
      writer: {
        revision: event.writer.revision,
        build: event.writer.build.length > 0 ? 'the build id' : '',
      },
      flags: event.flags,
      decision: event.decision,
      traceparent: event.traceparent,
      before: event.before,
      data: event.data,
    }));
}

describe('the change records of a receipt (S-145)', () => {
  test('acceptance writes created, completion writes changed, both transient and unhashed', async () => {
    await lendBook(runtime, 'Dune');
    const accepted = await askCloseAll(runtime, 'rec-1', testOperator('olive'));
    expect(accepted.ok).toBe(true);
    expect(await runtime.drainJobs()).toBe(1);
    const records = await receiptRecords();
    expect(
      records.map((record) => [record.type, record.version, record.transient, record.hash]),
    ).toEqual([
      ['core.commandReceipt.created', 1, true, null],
      ['core.commandReceipt.changed', 2, true, null],
    ]);
    expect(JSON.parse(JSON.stringify(records))).toEqual(stored()['rec-1']);
    expect(spy.completions.at(-1)?.outcome).toEqual({ kind: 'succeeded' });
  });

  test('a failed job writes changed with the failure', async () => {
    await askCloseAll(runtime, 'rec-2', testOperator('gone'));
    runtime.revoke('gone');
    expect(await runtime.drainJobs()).toBe(1);
    const mine = (await receiptRecords()).filter((record) => record.commandId === 'rec-2');
    expect(mine.map((record) => [record.type, record.version])).toEqual([
      ['core.commandReceipt.created', 1],
      ['core.commandReceipt.changed', 2],
    ]);
    expect(mine[1]?.data).toMatchObject({
      set: { status: 'failed', outcome: { ok: false, error: { kind: 'unauthenticated' } } },
    });
    expect(JSON.parse(JSON.stringify(mine))).toEqual(stored()['rec-2']);
  });
});
