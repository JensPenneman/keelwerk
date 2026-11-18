import { consumers, erasure, reactionDispatcher } from '@keelwerk/events';
import { expect, test, vi } from 'vitest';
import { createLocalClient } from '../../src/harness/create-local-client.ts';
import { startTestRuntime } from '../../src/harness/start-test-runtime.ts';
import { testOperator } from '../../src/harness/test-operator.ts';
import { testPrincipal } from '../../src/harness/test-principal.ts';
import { pgliteQuery } from './support/dump-sections.ts';
import { useEpochKit } from './support/epoch-kit.ts';
import { erasureQueuesApp, queuesControl } from './support/erasure-queues-module.ts';

const { directories } = useEpochKit();

const start = Temporal.Instant.from('2026-11-18T10:00:00Z');
const clock = { now: () => start };
const dispatcher = () => consumers({ consumers: [reactionDispatcher()], runs: ['asyncReactions'] });

test('the effect job of a held tenant waits: the executor runs after the completion, the attempt untouched', {
  timeout: 240_000,
}, async () => {
  queuesControl.executed = 0;
  const external = { factory: directories.durableFactory(), url: 'pglite' };
  // First boot: the command queues work, the queue of the executor has no slot, so an effect
  // requested now stays requested in its job.
  const worker = erasure({ pollMs: 3_600_000 });
  const first = await startTestRuntime(erasureQueuesApp, {
    external,
    clock,
    tenants: ['acme'],
    operators: true,
    workers: { queues: ['commands', 'reactions', 'schedules', 'timers'] },
    eventWorkers: [dispatcher(), worker],
  });
  directories.track(() => first.stop(1000));
  const operator = createLocalClient(first, { principal: testOperator(), tenant: 'acme' });
  const enrol = async (name: string, email: string): Promise<string> =>
    String(
      ((await operator.invoke('probe.enrol', { name, email })) as { personId: string }).personId,
    );
  const ada = await enrol('Ada', 'hold.ada@example.test');
  const bea = await enrol('Bea', 'hold.bea@example.test');
  const opened = (await operator.invoke('queues.open', {
    ownerId: bea as never,
    topic: 'billing',
  })) as { ticketId: string };
  await operator.invoke('queues.send', {
    ticketId: opened.ticketId as never,
    to: 'bea@example.test',
  });
  // An outside performer's effect with a deadline: its deadline job falls due while the tenant is held.
  const thread = (await operator.invoke('probe.open', {
    ownerId: bea as never,
    title: 'delivery',
  })) as { threadId: string };
  await createLocalClient(first, { principal: testPrincipal(bea), tenant: 'acme' }).invoke(
    'probe.reachOut',
    {
      threadId: thread.threadId as never,
      to: 'bea@example.test',
      deadline: start.add({ seconds: 3 }),
    },
  );
  await first.drainJobs();
  expect(queuesControl.executed).toBe(0);
  await directories.backUp();
  // Ada's erasure completes after the backup.
  await operator.invoke(
    'core.eraseSubject',
    { subjectId: ada as never, reason: 'subjectRequest' },
    { prefer: 'async' },
  );
  await first.drainJobs();
  await worker.pass();
  await first.drainJobs();
  const ids = {
    backendId: first.backendId,
    tenants: { acme: first.tenants.acme.id },
  };
  await first.stop(1000);
  directories.release();

  // The restore: the placement goes back to before the erasure; the control store keeps the
  // erasure and its completion. The erasure worker is not started yet, so the tenant stays held.
  await directories.restore();
  const later = erasure({ pollMs: 3_600_000 });
  let given: Parameters<typeof later.start>[0] | undefined;
  const second = await startTestRuntime(erasureQueuesApp, {
    external: { factory: directories.durableFactory(), url: 'pglite' },
    clock,
    tenants: ['acme'],
    operators: true,
    workers: true,
    join: ids,
    eventWorkers: [
      dispatcher(),
      {
        ...later,
        start: async (context) => {
          given = context;
        },
      },
    ],
  });
  directories.track(() => second.stop(1000));
  const jobRows = async (queue: string) =>
    pgliteQuery(second.adapter)(
      `select attempt, state from "${second.namespace.root}".kw_jobs where queue = '${queue}'`,
    );
  const deliveries = async () => {
    const descriptor = second.app.registry.entities.get('core.effect')?.descriptor;
    if (descriptor === undefined) throw new Error('no core.effect');
    const scope = {
      level: 'tenant',
      backendId: second.backendId,
      tenantId: second.tenants.acme.id,
    } as const;
    const rows = (
      await second.sealed.unit(second.namespace, scope, (unit) => unit.rows.find(descriptor, {}))
    ).rows;
    return rows.filter((row) => row.performer === 'external').map((row) => row.status);
  };
  // While the tenant is held the job is given back at once and again after each second: the
  // executor does not run and no attempt is used.
  await second.drainJobs();
  const before = await jobRows('queues-mail');
  expect(before).toHaveLength(1);
  expect(before[0]?.attempt).toBe(0);
  expect(await deliveries()).toEqual(['requested']);
  await second.advanceTo(start.add({ seconds: 2 }));
  await second.advanceTo(start.add({ seconds: 4 }));
  expect(queuesControl.executed).toBe(0);
  expect(await jobRows('queues-mail')).toEqual(before);
  // The deadline job is due since the second second, and the delivery is still requested.
  expect(await deliveries()).toEqual(['requested']);
  expect((await jobRows('timers')).map((row) => row.attempt)).toEqual([0]);

  // The completion ends the hold: the job runs.
  if (given === undefined) throw new Error('the erasure worker was not given its context');
  await later.start(given);
  await second.advanceTo(start.add({ seconds: 6 }));
  await vi.waitFor(() => expect(queuesControl.executed).toBe(1));
  await vi.waitFor(async () => expect(await deliveries()).not.toEqual(['requested']));
});
