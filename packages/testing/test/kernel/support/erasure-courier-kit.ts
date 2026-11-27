import type { ErasureRecord, ErasureStep, LedgerSink, Scope, StorageRow } from '@keelwerk/core';
import { deriveEffectId, parseSealedValueText } from '@keelwerk/core';
import { erasure } from '@keelwerk/events';
import { httpHost } from '@keelwerk/transport-http';
import { readEventStream } from '../../../src/conformance/transport/read-event-stream.ts';
import { createLocalClient } from '../../../src/harness/create-local-client.ts';
import { startTestRuntime } from '../../../src/harness/start-test-runtime.ts';
import { testCarrier } from '../../../src/harness/test-carrier.ts';
import { testOperator } from '../../../src/harness/test-operator.ts';
import { testPrincipal } from '../../../src/harness/test-principal.ts';
import { testPrincipalHeader } from '../../../src/harness/test-principal-header.ts';
import type { TestRuntimeOptions } from '../../../src/harness/test-runtime-options.ts';
import { attempt, courierApp } from './erasure-courier-app.ts';

/** The data subject of every shipment a test sends. */
const shipmentOwner = '0198a2c4-7e10-7a3b-8c5d-3f2a1b9d4e61';
const origin = 'https://courier.example.test';

/** What a test hangs on the steps of the erasure worker. */
interface CourierSeams {
  after?: (step: ErasureStep, record: ErasureRecord) => Promise<void>;
  inside?: (step: ErasureStep, record: ErasureRecord) => Promise<void>;
}

/** A runtime of the courier app with the erasure worker, its seams and the calls a test makes of it. */
async function bootCourier(
  options: {
    readonly adapter?: 'memory' | 'pglite';
    readonly ledgers?: readonly LedgerSink[];
    /** A database of its own (PostgreSQL), instead of the in-process adapter. */
    readonly external?: TestRuntimeOptions<'acme'>['external'];
  } = {},
) {
  const seams: CourierSeams = {};
  const worker = erasure({
    pollMs: 3_600_000,
    afterStep: (step, record) => seams.after?.(step, record) ?? Promise.resolve(),
    insideStep: (step, record) => seams.inside?.(step, record) ?? Promise.resolve(),
  });
  const runtime = await startTestRuntime(courierApp, {
    adapter: options.adapter ?? 'pglite',
    host: httpHost({}),
    workers: true,
    operators: true,
    tenants: ['acme'],
    eventWorkers: [worker],
    ...(options.ledgers === undefined ? {} : { ledgers: options.ledgers }),
    ...(options.external === undefined ? {} : { external: options.external }),
  });
  const { acme } = runtime.tenants;
  const scope: Scope = { level: 'tenant', backendId: runtime.backendId, tenantId: acme.id };
  const call = (action: string, input: unknown, commandId = crypto.randomUUID()) =>
    runtime.invoker.invoke<unknown, Record<string, unknown>>({
      action,
      input,
      carrier: testCarrier(acme, testPrincipal('ada')),
      requestId: crypto.randomUUID(),
      signal: new AbortController().signal,
      commandId,
    });
  const rows = (entity: string): Promise<readonly StorageRow[]> => {
    const descriptor = runtime.app.registry.entities.get(entity)?.descriptor;
    if (descriptor === undefined) throw new Error(`no entity ${entity}`);
    return runtime.sealed.unit(
      runtime.namespace,
      scope,
      async (unit) => (await unit.rows.find(descriptor, { includeArchived: true })).rows,
    );
  };
  const effectRow = async (id: string): Promise<StorageRow> => {
    const row = (await rows('core.effect')).find((candidate) => candidate.id === id);
    if (row === undefined) throw new Error(`no effect ${id}`);
    return row;
  };
  /** Sends a parcel of the owner with a secret waybill: the id of its effect and the command id. */
  const send = async (over: Record<string, unknown> = {}) => {
    const commandId = crypto.randomUUID();
    const outcome = await call(
      'courier.send',
      {
        owner: shipmentOwner,
        parcel: 'p-1',
        recipient: 'ada@example.org',
        waybill: 'waybill marker',
        ...over,
      },
      commandId,
    );
    if (!outcome.ok) throw new Error(`send refused: ${JSON.stringify(outcome)}`);
    return { commandId, id: deriveEffectId(scope, commandId, 0) };
  };
  /** The attempt records of an executor effect, in order: a start record, then an end record. */
  const attemptRecords = (effectId: string): Promise<readonly { endedAt?: string }[]> =>
    runtime.adapter.unit(runtime.namespace, scope, async (unit) =>
      (await unit.streams.read('core.effectAttempt', effectId, null, 100)).map(
        (stored) => stored.data as { endedAt?: string },
      ),
    );
  /** Asks the process to dispatch a parcel of the owner through its executor: the id of its effect. */
  const dispatch = async (recipient: string): Promise<string> => {
    const commandId = crypto.randomUUID();
    const outcome = await call(
      'courier.dispatchNow',
      { owner: shipmentOwner, recipient, waybill: 'waybill marker' },
      commandId,
    );
    if (!outcome.ok) throw new Error(`dispatch refused: ${JSON.stringify(outcome)}`);
    return deriveEffectId(scope, commandId, 0);
  };
  /** The performer reports a parcel shipped, with a secret seal. */
  const report = async (effectId: string, seal = 'seal marker') => {
    const outcome = await call('courier.report', { effectId, seal });
    if (!outcome.ok) throw new Error(`report refused: ${JSON.stringify(outcome)}`);
  };
  /** The operator asks for the erasure of the owner; the job runs, the worker's pass is the caller's. */
  const ask = async (subjectId: string = shipmentOwner): Promise<void> => {
    const operator = createLocalClient(runtime, { principal: testOperator(), tenant: 'acme' });
    await operator.invoke(
      'core.eraseSubject',
      { subjectId: subjectId as never, reason: 'subjectRequest' } as never,
      { prefer: 'async' },
    );
    await runtime.drainJobs();
  };
  /** The performer's stream of pending effects. */
  const follow = async () =>
    readEventStream(
      await runtime.fetch(
        new Request(`${origin}/_keelwerk/v1/subscribe?action=courier.pending&input=%7B%7D`, {
          headers: {
            'x-tenant': acme.id,
            [testPrincipalHeader]: JSON.stringify({ subject: 'courier', roles: [], claims: {} }),
          },
        }),
      ),
    );
  /** Whether the value key of the sealed text still opens it. */
  const opens = (text: unknown): Promise<boolean> => {
    const sealed = parseSealedValueText(String(text));
    if (sealed === undefined) throw new Error(`not a sealed text: ${String(text)}`);
    return runtime.sealed.unit(
      runtime.namespace,
      scope,
      async (unit) => (await unit.keys.openValue(sealed)) !== undefined,
    );
  };
  /** The key ids the control ledger holds tombstones for. */
  const tombstones = async (): Promise<readonly string[]> => {
    const entries = await runtime.control.adapter.unit(
      runtime.control.namespace,
      { level: 'deployment' },
      (unit) => unit.ledger?.since(0n, 1000) ?? Promise.resolve([]),
      { readOnly: true },
    );
    return entries.flatMap(({ record }) => (record.type === 'keyTombstone' ? [record.keyId] : []));
  };
  return {
    runtime,
    worker,
    seams,
    scope,
    call,
    rows,
    effectRow,
    send,
    dispatch,
    attempt,
    attemptRecords,
    report,
    ask,
    follow,
    opens,
    tombstones,
  };
}

export type { CourierSeams };
export { bootCourier };
