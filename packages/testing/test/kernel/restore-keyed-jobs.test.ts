import { expect, test, vi } from 'vitest';
import { createLocalClient } from '../../src/harness/create-local-client.ts';
import { startTestRuntime } from '../../src/harness/start-test-runtime.ts';
import { testOperator } from '../../src/harness/test-operator.ts';
import { pgliteQuery } from './support/dump-sections.ts';
import { useEpochKit } from './support/epoch-kit.ts';
import { restoreKeysApp, restoreKeysControl } from './support/restore-keys-module.ts';

const { directories } = useEpochKit();

const start = Temporal.Instant.from('2026-11-18T10:00:00Z');
const clock = { now: () => start };
const keys = { effectKey: 'chosen-effect', timerKey: 'chosen-timer', jobKey: 'chosen-job' };
const digest = /^[0-9a-f]{64}$/;

test('keys a module chose survive a restore: the effect job exists once, a repeated key is absorbed, the timer is reached', {
  timeout: 240_000,
}, async () => {
  restoreKeysControl.pinged.length = 0;
  restoreKeysControl.fired.length = 0;
  // First boot: the queue of the executor has no worker, so the effect job stays waiting.
  const first = await startTestRuntime(restoreKeysApp, {
    external: { factory: directories.durableFactory(), url: 'pglite' },
    clock,
    tenants: ['acme'],
    operators: true,
    workers: { queues: ['commands', 'reactions', 'schedules', 'timers'] },
  });
  directories.track(() => first.stop(1000));
  const operatorOf = (runtime: typeof first) =>
    createLocalClient(runtime, { principal: testOperator(), tenant: 'acme' });
  await operatorOf(first).invoke('restorekeys.request', { label: 'one', ...keys });
  await first.drainJobs();
  // The restored rows may be older than their jobs: the job of the requested effect is lost.
  const jobsOf = (runtime: typeof first, queue: string) =>
    pgliteQuery(runtime.adapter)(
      `select key, state, attempt from "${runtime.namespace.root}".kw_jobs where queue = '${queue}'`,
    );
  expect(await jobsOf(first, 'restorekeys-ping')).toHaveLength(1);
  await pgliteQuery(first.adapter)(
    `delete from "${first.namespace.root}".kw_jobs where queue = 'restorekeys-ping'`,
  );
  await directories.backUp();
  // The requests after the backup move the counters beyond what the restored placement holds.
  await operatorOf(first).invoke('restorekeys.request', {
    label: 'lost',
    effectKey: 'lost-effect',
    timerKey: 'lost-timer',
    jobKey: 'lost-job',
  });
  const ids = { backendId: first.backendId, tenants: { acme: first.tenants.acme.id } };
  await first.stop(1000);
  directories.release();

  await directories.restore();
  const second = await startTestRuntime(restoreKeysApp, {
    external: { factory: directories.durableFactory(), url: 'pglite' },
    clock,
    tenants: ['acme'],
    operators: true,
    workers: { queues: ['commands', 'reactions', 'schedules', 'timers'] },
    join: ids,
  });
  directories.track(() => second.stop(1000));
  const operator = operatorOf(second);
  const effects = async () => {
    const descriptor = second.app.registry.entities.get('core.effect')?.descriptor;
    if (descriptor === undefined) throw new Error('no core.effect');
    const scope = {
      level: 'tenant',
      backendId: second.backendId,
      tenantId: second.tenants.acme.id,
    } as const;
    return (
      await second.sealed.unit(second.namespace, scope, (unit) => unit.rows.find(descriptor, {}))
    ).rows;
  };

  // The restore check gave the requested effect its job again, once, under the effect id.
  const [effect] = await effects();
  expect(await effects()).toHaveLength(1);
  const pings = await jobsOf(second, 'restorekeys-ping');
  expect(pings).toHaveLength(1);
  expect(pings[0]?.key).toBe(String(effect?.id));
  // The key the module chose is stored as a digest, in the row and nowhere as text.
  expect(String(effect?.key)).toMatch(digest);
  expect(String(effect?.key)).not.toContain(keys.effectKey);
  expect(await jobsOf(second, 'commands')).toHaveLength(1);
  expect(await jobsOf(second, 'timers')).toHaveLength(1);

  // A second request under the same keys: the enqueue and the timer keep their one job each, and
  // the effect key digests to the same text as before the restore.
  await operator.invoke('restorekeys.request', { label: 'again', ...keys });
  expect(await jobsOf(second, 'commands')).toHaveLength(1);
  expect(await jobsOf(second, 'timers')).toHaveLength(1);
  const rows = await effects();
  expect(rows).toHaveLength(2);
  const again = rows.find((row) => row.id !== effect?.id);
  expect(again?.key).toBe(effect?.key);

  // The key text still reaches the timer after the restore.
  await operator.invoke('restorekeys.cancel', { timerKey: keys.timerKey });
  expect(await jobsOf(second, 'timers')).toEqual([]);

  // The executor runs once for each effect that exists: the restore added no second job.
  await second.stop(1000);
  const third = await startTestRuntime(restoreKeysApp, {
    external: { factory: directories.durableFactory(), url: 'pglite' },
    clock,
    tenants: ['acme'],
    operators: true,
    workers: true,
    join: ids,
  });
  directories.track(() => third.stop(1000));
  await vi.waitFor(() => expect([...restoreKeysControl.pinged].sort()).toEqual(['again', 'one']));
  await third.drainJobs();
  expect([...restoreKeysControl.pinged].sort()).toEqual(['again', 'one']);
  expect(restoreKeysControl.fired).toEqual([]);
});

test('a restore of a backup that still holds the effect job leaves one job, not two', {
  timeout: 240_000,
}, async () => {
  restoreKeysControl.pinged.length = 0;
  restoreKeysControl.fired.length = 0;
  const first = await startTestRuntime(restoreKeysApp, {
    external: { factory: directories.durableFactory(), url: 'pglite' },
    clock,
    tenants: ['acme'],
    operators: true,
    workers: { queues: ['commands', 'reactions', 'schedules', 'timers'] },
  });
  directories.track(() => first.stop(1000));
  await createLocalClient(first, { principal: testOperator(), tenant: 'acme' }).invoke(
    'restorekeys.request',
    { label: 'one', ...keys },
  );
  await first.drainJobs();
  const jobsOf = (runtime: typeof first) =>
    pgliteQuery(runtime.adapter)(
      `select key from "${runtime.namespace.root}".kw_jobs where queue = 'restorekeys-ping'`,
    );
  const before = await jobsOf(first);
  expect(before).toHaveLength(1);
  // The backup keeps the job: the restore check must find it alive and queue no second one.
  await directories.backUp();
  const ids = { backendId: first.backendId, tenants: { acme: first.tenants.acme.id } };
  await first.stop(1000);
  directories.release();

  await directories.restore();
  const second = await startTestRuntime(restoreKeysApp, {
    external: { factory: directories.durableFactory(), url: 'pglite' },
    clock,
    tenants: ['acme'],
    operators: true,
    workers: { queues: ['commands', 'reactions', 'schedules', 'timers'] },
    join: ids,
  });
  directories.track(() => second.stop(1000));
  expect(await jobsOf(second)).toEqual(before);
});
