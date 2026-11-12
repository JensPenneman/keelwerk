import type { LedgerRecord, LedgerSink, Unit } from '@keelwerk/core';
import { consumers, erasure, reactionDispatcher } from '@keelwerk/events';
import { afterEach, describe, expect, test } from 'vitest';
import { createLocalClient } from '../../src/harness/create-local-client.ts';
import { startTestRuntime } from '../../src/harness/start-test-runtime.ts';
import { testOperator } from '../../src/harness/test-operator.ts';
import type { TestRuntime } from '../../src/harness/test-runtime.ts';
import { erasureDumpApp } from './support/erasure-probe-module.ts';

type Runtime = TestRuntime<typeof erasureDumpApp>;

let current: Runtime | undefined;
afterEach(async () => {
  await current?.stop();
  current = undefined;
});

/** The id of the value key a stored credential value names (`kwv1.<key id>.…`, or the object form). */
function valueKeyIdOf(stored: unknown): string {
  const text = JSON.stringify(stored);
  const found = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/.exec(text);
  if (found?.[1] === undefined) throw new Error(`no value key id in ${text}`);
  return found[1];
}

describe('the tombstones of the value keys an erasure destroys (14.7.5 step 2, 14.7.6)', () => {
  test('a sink that fails after the control ledger took a tombstone loses none: the replay writes each to the control ledger once', {
    timeout: 60_000,
  }, async () => {
    const recorded: LedgerRecord[] = [];
    let adaKeyId = '';
    let refused = 0;
    // The sink refuses the first tombstone of a value key, as an unavailable log would.
    const sink: LedgerSink = {
      id: 'flaky',
      append: async (records) => {
        const first = records[0];
        if (refused === 0 && first?.type === 'keyTombstone' && first.keyId !== adaKeyId) {
          refused += 1;
          throw new Error('the sink is unavailable');
        }
        recorded.push(...records);
      },
      read: async function* () {
        yield* recorded;
      },
    };
    const worker = erasure({ pollMs: 3_600_000 });
    const runtime = await startTestRuntime(erasureDumpApp, {
      adapter: 'memory',
      operators: true,
      workers: true,
      ledgers: [sink],
      eventWorkers: [
        consumers({ consumers: [reactionDispatcher()], runs: ['asyncReactions'] }),
        worker,
      ],
    });
    current = runtime;
    const operator = createLocalClient(runtime, { principal: testOperator(), tenant: 'acme' });
    const ada = String(
      (
        (await operator.invoke('probe.enrol', {
          name: 'Ada',
          email: 'tombstone.ada@example.test',
          token: 'tombstone-secret',
        })) as { personId: string }
      ).personId,
    );
    const scope = {
      level: 'tenant',
      backendId: runtime.backendId,
      tenantId: runtime.tenants.acme.id,
    } as const;
    const inTenant = <T>(fn: (unit: Unit) => Promise<T>): Promise<T> =>
      runtime.adapter.unit(runtime.namespace, scope, fn);
    adaKeyId = (await inTenant((unit) => unit.keys.dataKey(ada, { create: false })))?.id ?? '';
    expect(adaKeyId).not.toBe('');
    const person = runtime.app.registry.entities.get('probe.person');
    if (person === undefined) throw new Error('no probe.person');
    const row = await inTenant((unit) =>
      unit.rows.findOne(person.descriptor, { where: { op: 'eq', field: 'id', value: ada } }),
    );
    const valueKeyId = valueKeyIdOf(row?.token);
    expect(valueKeyId).not.toBe(adaKeyId);

    await operator.invoke(
      'core.eraseSubject',
      { subjectId: ada as never, reason: 'subjectRequest' },
      { prefer: 'async' },
    );
    await runtime.drainJobs();
    // The first pass fails at the sink, before the unit that destroys the value key.
    await worker.pass();
    expect(refused).toBe(1);
    // The replay finishes the erasure.
    await worker.pass();

    const ledger = await runtime.control.adapter.unit(
      runtime.control.namespace,
      { level: 'deployment' },
      (unit) => unit.ledger?.since(0n, 100) ?? Promise.resolve([]),
      { readOnly: true },
    );
    const tombstonesOf = (records: readonly LedgerRecord[]) =>
      records.flatMap((record) => (record.type === 'keyTombstone' ? [record.keyId] : [])).sort();
    const expected = [adaKeyId, valueKeyId].sort();
    expect(tombstonesOf(ledger.map((entry) => entry.record))).toEqual(expected);
    // A repair sends every tombstone of the step to the sinks again, so a sink may hold one twice;
    // readers keep each key id once, and none is lost.
    expect([...new Set(tombstonesOf(recorded))]).toEqual(expected);
    expect(await inTenant((unit) => unit.keys.keyById(valueKeyId))).toBeUndefined();
  });
});
