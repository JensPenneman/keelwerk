import { AsyncLocalStorage } from 'node:async_hooks';
import { parseSealedValueText } from '@keelwerk/core';
import { afterEach, expect, test } from 'vitest';
import { pgliteQuery } from './support/dump-sections.ts';
import { bootQueues, stopQueues } from './support/erasure-queues-kit.ts';
import { watchedSink } from './support/watched-sink.ts';

afterEach(stopQueues);

const sealedTexts = (rows: readonly Record<string, unknown>[]): string[] =>
  rows.flatMap(
    (row) => JSON.stringify(row.input).match(/kwv1\.[^."\\]+\.[^."\\]+\.[^."\\]+/g) ?? [],
  );

test('no tenant write unit of the erasure is open while a tombstone is appended to a sink', {
  timeout: 120_000,
}, async () => {
  // The writing tenant units the erasure's pass opens are counted through the adapter, from the
  // moment each opens to the moment it ends; every tombstone batch a sink takes finds none open.
  const inPass = new AsyncLocalStorage<boolean>();
  const open = { now: 0 };
  const seen: number[] = [];
  const sink = watchedSink((records) => {
    if (records.some((record) => record.type === 'keyTombstone')) seen.push(open.now);
    return Promise.resolve();
  });
  const booted = await bootQueues({ ledgers: [sink] });
  const { adapter } = booted.runtime;
  const inner = adapter.unit.bind(adapter);
  adapter.unit = (namespace, scope, fn, options) => {
    if (inPass.getStore() !== true || scope.level !== 'tenant' || options?.readOnly === true) {
      return inner(namespace, scope, fn, options);
    }
    open.now += 1;
    return inner(namespace, scope, fn, options).finally(() => {
      open.now -= 1;
    });
  };
  await booted
    .userClient(booted.subject)
    .invoke('queues.stash', { note: 'own stash marker' as never }, { prefer: 'async' });
  await booted.runtime.drainJobs();
  await booted.operator.invoke(
    'core.eraseSubject',
    { subjectId: booted.subject as never, reason: 'subjectRequest' },
    { prefer: 'async' },
  );
  await booted.runtime.drainJobs();
  await inPass.run(true, () => booted.worker.pass());
  await booted.runtime.drainJobs();
  expect(seen.length).toBeGreaterThan(0);
  expect(seen.every((count) => count === 0)).toBe(true);
});

test('a job enqueued after the purge rolled back for a key is not purged without its tombstone', {
  timeout: 120_000,
}, async () => {
  // The first purge unit met the first job's key and rolled back; the tombstone reaches the sink with
  // no unit open: the subject's principal enqueues another job with a secret then, which the next
  // unit meets and rolls back for too.
  const late: { key?: string; enqueue?: () => Promise<unknown> } = {};
  const sink = watchedSink(async (records) => {
    if (!records.some((record) => record.type === 'keyTombstone' && record.keyId === late.key)) {
      return;
    }
    const { enqueue } = late;
    delete late.enqueue;
    await enqueue?.();
  });
  const booted = await bootQueues({ ledgers: [sink] });
  const user = booted.userClient(booted.subject);
  await user.invoke('queues.stash', { note: 'first stash marker' as never }, { prefer: 'async' });
  await booted.runtime.drainJobs();
  const jobsOf = async () =>
    (await booted.framework('kw_jobs')).filter((row) =>
      JSON.stringify(row.input).includes('queues.stash'),
    );
  const first = sealedTexts(await jobsOf());
  expect(first).toHaveLength(1);
  late.key = String(parseSealedValueText(first[0] ?? '')?.keyId);
  let second: string | undefined;
  late.enqueue = async () => {
    await user.invoke(
      'queues.stash',
      { note: 'second stash marker' as never },
      { prefer: 'async' },
    );
    // Its first attempt runs now and leaves it waiting for a retry, so no worker holds it later.
    await booted.runtime.drainJobs();
    second = sealedTexts(await jobsOf()).find((text) => text !== first[0]);
  };

  await booted.erase(booted.subject);

  expect(late.enqueue).toBeUndefined();
  expect(await jobsOf()).toEqual([]);
  const tombstoned = (
    await booted.runtime.control.adapter.unit(
      booted.runtime.control.namespace,
      { level: 'deployment' },
      (unit) => unit.ledger?.since(0n, 1000) ?? Promise.resolve([]),
      { readOnly: true },
    )
  ).flatMap(({ record }) => (record.type === 'keyTombstone' ? [record.keyId] : []));
  expect(second).toBeDefined();
  for (const text of [first[0], second]) {
    expect(tombstoned).toContain(parseSealedValueText(text ?? '')?.keyId);
  }
});

test('a job that turns running after its key was learned is kept, and its key does not stay live under a tombstone', {
  timeout: 120_000,
}, async () => {
  // The first purge unit met the job's key and rolled back. While its tombstone is with the sink, a
  // worker takes the job: the next unit does not purge a running job, yet the key has a tombstone.
  const turn: { key?: string; run?: () => Promise<void> } = {};
  const sink = watchedSink(async (records) => {
    if (!records.some((record) => record.type === 'keyTombstone' && record.keyId === turn.key)) {
      return;
    }
    const { run } = turn;
    delete turn.run;
    await run?.();
  });
  const booted = await bootQueues({ ledgers: [sink] });
  await booted
    .userClient(booted.subject)
    .invoke('queues.stash', { note: 'own stash marker' as never }, { prefer: 'async' });
  await booted.runtime.drainJobs();
  const stashJobs = async () =>
    (await booted.framework('kw_jobs')).filter((row) =>
      JSON.stringify(row.input).includes('queues.stash'),
    );
  const [job] = await stashJobs();
  const text = sealedTexts(job === undefined ? [] : [job])[0] ?? '';
  const sealed = parseSealedValueText(text);
  turn.key = String(sealed?.keyId);
  let taken = 0;
  turn.run = async () => {
    // The retry becomes due without the clock moving, so no worker takes it first.
    const query = pgliteQuery(booted.runtime.adapter);
    const [home] = await query("select schemaname from pg_tables where tablename = 'kw_jobs'");
    await query(
      `update "${String(home?.schemaname)}".kw_jobs set run_at = created_at where id = ${Number(job?.id)}`,
    );
    const result = await booted.inTenant(async (unit) => {
      await unit.jobs.promote('commands', 10);
      return unit.jobs.take('commands', 'probe.taker', {
        limit: 1,
        capabilitySets: [''],
        maxRevision: Number(job?.revision),
        leaseMs: 3_600_000,
      });
    });
    taken = result.jobs.length;
  };

  await booted.erase(booted.subject);

  expect(turn.run).toBeUndefined();
  expect(taken).toBe(1);
  expect((await stashJobs()).map((row) => row.state)).toEqual(['running']);
  const tombstoned = (
    await booted.runtime.control.adapter.unit(
      booted.runtime.control.namespace,
      { level: 'deployment' },
      (unit) => unit.ledger?.since(0n, 1000) ?? Promise.resolve([]),
      { readOnly: true },
    )
  ).flatMap(({ record }) => (record.type === 'keyTombstone' ? [record.keyId] : []));
  expect(tombstoned).toContain(turn.key);
  expect(
    await booted.inTenant(async (unit) =>
      sealed === undefined ? undefined : await unit.keys.openValue(sealed),
    ),
  ).toBeUndefined();
});

test('a rerun after a crash destroys the key of a job that turned running meanwhile, which its tombstone names', {
  timeout: 120_000,
}, async () => {
  // The first unit that purges the job met its key and rolled back; while its tombstone is with the
  // sink a worker takes the job, and the repeat of the unit crashes. The pass that runs the record again
  // learns the tombstones of this erasure from the control ledger and destroys the key that opens.
  const turn: { key?: string; run?: () => Promise<void> } = {};
  const sink = watchedSink(async (records) => {
    if (!records.some((record) => record.type === 'keyTombstone' && record.keyId === turn.key)) {
      return;
    }
    const { run } = turn;
    delete turn.run;
    await run?.();
  });
  let crashed = false;
  const booted = await bootQueues({
    ledgers: [sink],
    erasure: {
      insideStep: (step) => {
        // The first unit of a step that starts after the job was taken is the repeat.
        if (step === 'flags' || turn.run !== undefined || crashed) return Promise.resolve();
        crashed = true;
        return Promise.reject(new Error('crash in the repeat'));
      },
    },
  });
  await booted
    .userClient(booted.subject)
    .invoke('queues.stash', { note: 'own stash marker' as never }, { prefer: 'async' });
  await booted.runtime.drainJobs();
  const stashJobs = async () =>
    (await booted.framework('kw_jobs')).filter((row) =>
      JSON.stringify(row.input).includes('queues.stash'),
    );
  const [job] = await stashJobs();
  const sealed = parseSealedValueText(sealedTexts(job === undefined ? [] : [job])[0] ?? '');
  turn.key = String(sealed?.keyId);
  turn.run = async () => {
    const query = pgliteQuery(booted.runtime.adapter);
    const [home] = await query("select schemaname from pg_tables where tablename = 'kw_jobs'");
    await query(
      `update "${String(home?.schemaname)}".kw_jobs set run_at = created_at where id = ${Number(job?.id)}`,
    );
    await booted.inTenant(async (unit) => {
      await unit.jobs.promote('commands', 10);
      await unit.jobs.take('commands', 'probe.taker', {
        limit: 1,
        capabilitySets: [''],
        maxRevision: Number(job?.revision),
        leaseMs: 3_600_000,
      });
    });
  };
  const opens = () =>
    booted.inTenant(async (unit) =>
      sealed === undefined ? undefined : await unit.keys.openValue(sealed),
    );
  const completed = async () =>
    (
      await booted.runtime.control.adapter.unit(
        booted.runtime.control.namespace,
        { level: 'deployment' },
        (unit) => unit.ledger?.since(0n, 1000) ?? Promise.resolve([]),
        { readOnly: true },
      )
    ).some(({ record }) => record.type === 'erasureCompleted');

  await booted.erase(booted.subject);

  // The crash left the erasure unfinished, the job running and its key still open under a tombstone.
  expect(turn.run).toBeUndefined();
  expect(crashed).toBe(true);
  expect(await completed()).toBe(false);
  expect(await opens()).toBeDefined();

  await booted.worker.pass();
  await booted.runtime.drainJobs();

  expect(await completed()).toBe(true);
  expect((await stashJobs()).map((row) => row.state)).toEqual(['running']);
  expect(await opens()).toBeUndefined();
});
