import { AsyncLocalStorage } from 'node:async_hooks';
import { afterAll, describe, expect, test } from 'vitest';
import { createLocalClient } from '../../src/harness/create-local-client.ts';
import { startTestRuntime } from '../../src/harness/start-test-runtime.ts';
import { testOperator } from '../../src/harness/test-operator.ts';
import { pgliteQuery } from './support/dump-sections.ts';
import { dumpDispatcher } from './support/erasure-dump-markers.ts';
import { rowsOf } from './support/erasure-dump-tools.ts';
import { erasureDumpApp } from './support/erasure-probe-module.ts';

const dispatcher = dumpDispatcher();
const runtime = await startTestRuntime(erasureDumpApp, {
  adapter: 'pglite',
  operators: true,
  workers: true,
  eventWorkers: [dispatcher],
  // No key stays cached, so every derivation misses and reads the control store.
  keyCache: { ttlMs: 0 },
});
afterAll(() => runtime.stop());

// A derivation reads the scope keys of the control store. The harness runs the control store and
// the tenant data as two PGlite instances, so a derivation inside an open tenant unit does not wait
// here; the test counts the control reads that the three ScopeSecrets derivations (the job key, the
// fingerprint key and the state token key) make inside an open tenant unit. A store that held both
// on one session would wait on such a read. Those secrets are derived before the unit opens.
const secretDerivations = /state-token-key\.ts|job-key-secret-of\.ts|command-fingerprint\.ts/;
const insideDataUnit = new AsyncLocalStorage<true>();
const secretReadsInDataUnits: string[] = [];
const { adapter: data } = runtime;
const dataUnit = data.unit.bind(data);
data.unit = (namespace, scope, work, options) =>
  dataUnit(namespace, scope, (unit) => insideDataUnit.run(true, () => work(unit)), options);
const { adapter: control } = runtime.control;
const controlUnit = control.unit.bind(control);
control.unit = (namespace, scope, work, options) => {
  if (insideDataUnit.getStore() !== true) return controlUnit(namespace, scope, work, options);
  const asked = new Error().stack ?? '';
  return controlUnit(
    namespace,
    scope,
    (unit) =>
      work(
        new Proxy(unit, {
          get(target, key) {
            if (key === 'scopeKeys' && secretDerivations.test(asked)) {
              secretReadsInDataUnits.push(asked);
            }
            return Reflect.get(target, key, target);
          },
        }),
      ),
    options,
  );
};

const queries = [pgliteQuery(runtime.adapter), pgliteQuery(runtime.control.adapter)];
const tenantId = runtime.tenants.acme?.id ?? '';

/** The scope keys of the control store that belong to the tenant. */
const tenantKeys = async () =>
  (await rowsOf(queries, 'kw_scope_keys')).filter((row) => JSON.stringify(row).includes(tenantId));

describe('a fresh tenant scope on a PGlite store without a cached key', () => {
  test('a plain command that sets a timer, then an async reaction batch, derive no secret in a unit', {
    timeout: 60_000,
  }, async () => {
    expect(await tenantKeys(), 'the tenant has no scope key before its first write').toEqual([]);
    const operator = createLocalClient(runtime, { principal: testOperator(), tenant: 'acme' });
    const person = await operator.invoke('probe.enrol', {
      name: 'Ada',
      email: 'fresh.scope@example.test',
    });
    expect((await tenantKeys()).length, 'the first write created the scope key').toBe(1);
    const thread = await operator.invoke('probe.open', {
      ownerId: person.personId as never,
      title: 'fresh',
    });
    // A plain command sets the timer: it takes the secret derived before its unit.
    await operator.invoke('probe.arm', { threadId: thread.threadId as never });
    // The thread started an async reaction batch: the dispatcher derives its secrets first.
    // A generated set seals its state token with the key derived before its unit opened.
    const set = await operator.invoke('probe.person.set', {
      create: [{ name: 'Bea', email: 'fresh.set@example.test' }],
    });
    expect((set as { created: string[] }).created).toHaveLength(1);
    await dispatcher.settled();
    await runtime.drainJobs();
    const jobs = await rowsOf(queries, 'kw_jobs');
    const history = await rowsOf(queries, 'kw_job_history');
    expect(
      [...jobs, ...history].some((row) => row.queue === 'reactions'),
      'the batch of async reactions queued and ran its jobs',
    ).toBe(true);
    const timer = jobs.find((row) => row.queue === 'timers' && /^probe:/.test(String(row.key)));
    expect(timer?.key, 'the timer is stored under its module and a 64-character digest').toMatch(
      /^probe:[0-9a-f]{64}$/,
    );
    expect((await tenantKeys()).length, 'the scope key was created once').toBe(1);
    expect(secretReadsInDataUnits, 'no secret of the write was derived inside a unit').toEqual([]);
  });
});
