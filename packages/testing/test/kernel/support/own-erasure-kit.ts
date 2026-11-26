import type { FlagProvider, Logger, Scope, StorageRow } from '@keelwerk/core';
import { erasure } from '@keelwerk/events';
import { createLocalClient } from '../../../src/harness/create-local-client.ts';
import { startTestRuntime } from '../../../src/harness/start-test-runtime.ts';
import { testOperator } from '../../../src/harness/test-operator.ts';
import type { TestRuntime } from '../../../src/harness/test-runtime.ts';
import {
  erasureHold,
  legalHold,
  legalHoldAsyncProvider,
  legalHoldProvider,
  ownErasureApp,
} from './own-erasure-module.ts';

type Runtime = TestRuntime<typeof ownErasureApp>;
type Caller = {
  invoke: (action: string, input: unknown) => Promise<Record<string, unknown>>;
  attempt: (
    action: string,
    input: unknown,
  ) => Promise<{ ok: boolean; error?: { kind: string; code: string; message: string } }>;
};

let current: Runtime | undefined;
/** Puts the holds off and stops the runtime of the case; each test file runs it after every case. */
async function resetOwnErasure(): Promise<void> {
  erasureHold.on = false;
  erasureHold.failing = false;
  legalHold.on = false;
  legalHold.failing = false;
  await current?.stop();
  current = undefined;
}

/** The warnings an own-subject erasure logs when it is put off, with their fields. */
const putOff: Record<string, unknown>[] = [];
const log: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: (message, fields) => {
    if (message === 'an erasure is put off') putOff.push({ ...fields });
  },
  error: () => undefined,
  child: () => log,
};

async function boot(adapter: 'memory' | 'pglite', provider: FlagProvider = legalHoldProvider) {
  putOff.length = 0;
  const worker = erasure({ pollMs: 3_600_000 });
  const runtime = await startTestRuntime(ownErasureApp, {
    adapter,
    operators: true,
    workers: true,
    logger: log,
    eventWorkers: [worker],
    flagProviders: [provider],
  });
  current = runtime;
  const operator = createLocalClient(runtime, {
    principal: testOperator(),
    tenant: 'acme',
  }) as unknown as Caller;
  const scope: Scope = {
    level: 'tenant',
    backendId: runtime.backendId,
    tenantId: runtime.tenants.acme?.id ?? '',
  };
  /** The job of the request, the steps of the worker and the jobs those leave. */
  const settle = async (): Promise<void> => {
    await runtime.drainJobs();
    await worker.pass();
    await runtime.drainJobs();
  };
  const rows = (ref: string, opened: boolean): Promise<readonly StorageRow[]> => {
    const descriptor = runtime.app.registry.entities.get(ref)?.descriptor;
    if (descriptor === undefined) throw new Error(`no entity ${ref}`);
    const unitOf = opened
      ? runtime.sealed.unit.bind(runtime.sealed)
      : runtime.adapter.unit.bind(runtime.adapter);
    return unitOf(
      runtime.namespace,
      scope,
      async (unit) =>
        (await unit.rows.find(descriptor, { includeArchived: true, includeErased: !opened })).rows,
    );
  };
  const keyLive = (subject: string): Promise<boolean> =>
    runtime.adapter.unit(
      runtime.namespace,
      scope,
      async (unit) => (await unit.keys.dataKey(subject, { create: false })) !== undefined,
      { readOnly: true },
    );
  const ledger = () =>
    runtime.control.adapter.unit(
      runtime.control.namespace,
      { level: 'deployment' },
      (unit) => unit.ledger?.since(0n, 100) ?? Promise.resolve([]),
      { readOnly: true },
    );
  return { runtime, operator, worker, settle, rows, keyLive, ledger };
}

const providers = [
  ['synchronous', legalHoldProvider],
  ['asynchronous', legalHoldAsyncProvider],
] as const;

/**
 * Runs `hook` as the read of the references of a subject with a limit of two, which the ownership
 * check of an own-subject erasure makes, ends; answers what puts the adapter back.
 */
function afterOwnershipRead(store: TestRuntime<typeof ownErasureApp>['adapter'], hook: () => void) {
  const unit = store.unit.bind(store);
  store.unit = ((namespace, scope, work, options) =>
    unit(
      namespace,
      scope,
      (open) =>
        work(
          new Proxy(open, {
            get: (target, key) => {
              const value = Reflect.get(target, key);
              if (key !== 'keys') return typeof value === 'function' ? value.bind(target) : value;
              return new Proxy(value, {
                get: (keys, name) => {
                  const member = Reflect.get(keys, name);
                  if (name !== 'refs')
                    return typeof member === 'function' ? member.bind(keys) : member;
                  return async (...args: unknown[]) => {
                    const found = await member.apply(keys, args);
                    if (args[2] === 2) hook();
                    return found;
                  };
                },
              });
            },
          }),
        ),
      options,
    )) as typeof store.unit;
  return () => {
    store.unit = unit as typeof store.unit;
  };
}

/** The `core.flag` row that turns `oes.legalHold` on or off for every tenant. */
const targeting = (value: boolean) => ({
  key: 'oes.legalHold',
  targeting: { enabled: true, rules: [], fallthrough: { value } },
  reason: 'legal hold',
});

const person = () => crypto.randomUUID();
const erasures = (entries: readonly { readonly record: unknown }[]) =>
  entries
    .map((entry) => entry.record as Record<string, unknown>)
    .filter((r) => r.type === 'erasure');

export {
  afterOwnershipRead,
  boot,
  current,
  erasures,
  person,
  providers,
  putOff,
  resetOwnErasure,
  targeting,
};
