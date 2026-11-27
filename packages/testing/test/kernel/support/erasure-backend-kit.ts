import { createControlLedger, type LedgerRecord, type Scope } from '@keelwerk/core';
import { erasure } from '@keelwerk/events';
import { createLocalClient } from '../../../src/harness/create-local-client.ts';
import { testOperator } from '../../../src/harness/test-operator.ts';
import type { TestRuntime } from '../../../src/harness/test-runtime.ts';
import type { backendApp } from './erasure-backend-app.ts';
import { stampAs } from './erasure-backend-stamp.ts';
import { watchedSink } from './watched-sink.ts';

export type Runtime = TestRuntime<typeof backendApp>;
export type Worker = ReturnType<typeof erasure>;
export type Tenant = 'acme' | 'globex';

/** What a store of the backend cases brings: a runtime of the app on its adapter, closed when the case ends. */
export interface BackendHost {
  readonly start: (setup: {
    readonly worker: Worker;
    readonly sink: ReturnType<typeof watchedSink>;
  }) => Promise<Runtime>;
}

/** A runtime of the backend app with an erasure worker and a sink, and what the cases look at in it. */
export async function bootBackend(
  host: BackendHost,
  hooks: Parameters<typeof erasure>[0] = {},
  refuses: (records: readonly LedgerRecord[]) => boolean | Promise<boolean> = () => false,
) {
  const taken: LedgerRecord[] = [];
  const sink = watchedSink(async (records) => {
    if (await refuses(records)) throw new Error('the sink refused');
    taken.push(...records);
  });
  const worker = erasure({ pollMs: 3_600_000, ...hooks });
  const runtime = await host.start({ worker, sink });
  const backend: Scope = { level: 'backend', backendId: runtime.backendId };
  const inBackend = <T>(fn: Parameters<typeof runtime.adapter.unit<T>>[2]) =>
    runtime.adapter.unit(runtime.namespace, backend, fn);
  const client = (tenant: Tenant) =>
    createLocalClient(runtime, { principal: testOperator(), tenant });
  const make = async (tenant: Tenant, action: string, input: unknown) =>
    String(((await client(tenant).invoke(action as never, input as never)) as { id: string }).id);
  const stamp = (principalId: string) => stampAs(runtime, principalId);
  /** The id of the key a stamp's request record was sealed under, and whether it opens now. */
  const recorded = async (principalId: string) => {
    const outcome = await stamp(principalId);
    if (!outcome.ok) throw outcome.error;
    const noteId = (outcome.value as { id: string }).id;
    return inBackend(async (unit) => {
      const events = await unit.events.readStream({ type: 'bk.note', id: noteId });
      const request = events.find((event) => event.decision?.request !== undefined)?.decision
        ?.request;
      if (request === undefined || '$kwe' in request) throw new Error('no request record');
      return { request, keyId: request.keyId };
    });
  };
  const opens = (found: { readonly request: never }) =>
    inBackend(async (unit) => (await unit.keys.openValue(found.request)) !== undefined);
  /** The scopes the control ledger holds a tombstone of the key id for. */
  const tombstones = async (keyId: string) =>
    (
      await createControlLedger(runtime.control.adapter, runtime.control.namespace).find([
        { type: 'keyTombstone', keyId },
      ])
    ).flatMap(({ record }) => (record.type === 'keyTombstone' ? [record.scopeId] : []));
  /** The scopes the sink holds a tombstone of the key id for. */
  const sinkTombstones = (keyId: string) =>
    taken.flatMap((record) =>
      record.type === 'keyTombstone' && record.keyId === keyId ? [record.scopeId] : [],
    );
  const erase = async (subject: string, tenant: Tenant = 'acme') => {
    await client(tenant).invoke(
      'core.eraseSubject',
      { subjectId: subject as never, reason: 'subjectRequest' } as never,
      { prefer: 'async' },
    );
    await runtime.drainJobs();
    await worker.pass();
    await runtime.drainJobs();
  };
  return {
    runtime,
    taken,
    worker,
    inBackend,
    make,
    stamp,
    recorded,
    opens,
    tombstones,
    sinkTombstones,
    erase,
  };
}
