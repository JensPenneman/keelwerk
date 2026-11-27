import type { LedgerRecord, Scope } from '@keelwerk/core';
import {
  defineApp,
  defineCommand,
  defineEntity,
  defineModule,
  defineModuleBase,
  defineRule,
  field,
  shape,
} from '@keelwerk/core';
import { erasure } from '@keelwerk/events';
import { afterEach, expect, test } from 'vitest';
import { createLocalClient } from '../../src/harness/create-local-client.ts';
import { startTestRuntime } from '../../src/harness/start-test-runtime.ts';
import { testOperator } from '../../src/harness/test-operator.ts';
import type { TestRuntime } from '../../src/harness/test-runtime.ts';
import { watchedSink } from './support/watched-sink.ts';

const member = defineEntity({
  prefix: 'zom',
  dataSubject: 'id',
  fields: { email: field.string().personal() },
});
/** A row whose data subject is an optional field: it can be cleared. */
const parcel = defineEntity({
  prefix: 'zop',
  dataSubject: 'owner',
  fields: { owner: field.subject().optional(), secret: field.secret() },
});
const base = defineModuleBase({ id: 'orph', version: '0.1.0', entities: { member, parcel } });
const enrol = defineCommand(base, {
  input: shape({ email: field.string() }),
  output: shape({ id: field.ref.own('member') }),
  principal: 'operator',
  *decide(input, ctx) {
    const id = yield* ctx.newId(member);
    return { events: [ctx.write.orph.member.create({ id, email: input.email })], result: { id } };
  },
});
const post = defineCommand(base, {
  input: shape({ owner: field.subject(), secret: field.secret() }),
  output: shape({ id: field.ref.own('parcel') }),
  principal: 'operator',
  *decide(input, ctx) {
    const id = yield* ctx.newId(parcel);
    return {
      events: [ctx.write.orph.parcel.create({ id, owner: input.owner, secret: input.secret })],
      result: { id },
    };
  },
});
const release = defineCommand(base, {
  input: shape({ id: field.ref.own('parcel') }),
  principal: 'operator',
  *decide(input, ctx) {
    const row = yield* ctx.load.orph.parcel.one({ where: { id: input.id } });
    return row === undefined ? [] : [ctx.write.orph.parcel.update(row, { owner: null as never })];
  },
});
const orph = defineModule(base, {
  actions: { enrol, post, release },
  policies: {
    enrol: { operator: defineRule(base, enrol, { effect: 'allow', principal: 'operator' }) },
    post: { operator: defineRule(base, post, { effect: 'allow', principal: 'operator' }) },
    release: { operator: defineRule(base, release, { effect: 'allow', principal: 'operator' }) },
  },
});
const orphApp = defineApp({ id: 'erasure-orphan', modules: [orph] });

let current: TestRuntime<typeof orphApp> | undefined;
afterEach(async () => {
  await current?.stop();
  current = undefined;
});

/** The id of the value key a stored secret names. */
const keyOf = (stored: unknown): string =>
  /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/.exec(
    JSON.stringify(stored),
  )?.[1] ?? '';

test('a row whose owner is cleared while its erasure runs belongs to no living subject and is erased, its tombstone true', {
  timeout: 60_000,
}, async () => {
  const hook: { key?: string; run?: () => Promise<void> } = {};
  const sink = watchedSink(async (records: readonly LedgerRecord[]) => {
    if (!records.some((r) => r.type === 'keyTombstone' && r.keyId === hook.key)) return;
    const { run } = hook;
    delete hook.run;
    await run?.();
  });
  const worker = erasure({ pollMs: 3_600_000 });
  const runtime = await startTestRuntime(orphApp, {
    adapter: 'memory',
    operators: true,
    workers: true,
    tenants: ['acme'],
    eventWorkers: [worker],
    ledgers: [sink],
  });
  current = runtime;
  const scope: Scope = {
    level: 'tenant',
    backendId: runtime.backendId,
    tenantId: runtime.tenants.acme.id,
  };
  const operator = createLocalClient(runtime, { principal: testOperator(), tenant: 'acme' });
  const rowOf = (id: string) =>
    runtime.adapter.unit(runtime.namespace, scope, async (unit) => {
      const descriptor = runtime.app.registry.entities.get('orph.parcel')?.descriptor;
      if (descriptor === undefined) throw new Error('no entity');
      return (
        await unit.rows.find(descriptor, { includeArchived: true, includeErased: true })
      ).rows.find((row) => row.id === id);
    });
  const idOf = (made: unknown) => String((made as { id: string }).id);
  const ada = idOf(await operator.invoke('orph.enrol', { email: 'ada@example.test' }));
  const parcelId = idOf(
    await operator.invoke('orph.post', { owner: ada as never, secret: 'ada secret' }),
  );
  hook.key = keyOf((await rowOf(parcelId))?.secret);
  let released: unknown;
  hook.run = async () => {
    // The sink that takes the tombstone of the parcel's key: the erasure has not reached the row's unit.
    released = await operator.attempt('orph.release', { id: parcelId as never });
  };
  await operator.invoke(
    'core.eraseSubject',
    { subjectId: ada as never, reason: 'subjectRequest' } as never,
    { prefer: 'async' },
  );
  await runtime.drainJobs();
  await worker.pass();
  await runtime.drainJobs();

  expect(hook.run).toBeUndefined();
  expect(released).toMatchObject({ ok: true });
  const after = await rowOf(parcelId);
  expect(after?.owner ?? null).toBeNull();
  expect(after?.kwErasedAt ?? null).not.toBeNull();
  const live = await runtime.adapter.unit(runtime.namespace, scope, (unit) =>
    unit.keys.liveValueKeys([hook.key ?? '']),
  );
  expect(live).toEqual([]);
  const ledger = await runtime.control.adapter.unit(
    runtime.control.namespace,
    { level: 'deployment' },
    (unit) => unit.ledger?.since(0n, 1000) ?? Promise.resolve([]),
    { readOnly: true },
  );
  expect(
    ledger.some(({ record }) => record.type === 'keyTombstone' && record.keyId === hook.key),
  ).toBe(true);
});
