import type { ErasureRecord, ErasureStep, LedgerRecord, Scope } from '@keelwerk/core';
import {
  createControlLedger,
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
import { createLocalClient } from '../../../src/harness/create-local-client.ts';
import { startTestRuntime } from '../../../src/harness/start-test-runtime.ts';
import { testCarrier } from '../../../src/harness/test-carrier.ts';
import { testOperator } from '../../../src/harness/test-operator.ts';
import { testPrincipal } from '../../../src/harness/test-principal.ts';
import type { TestRuntime } from '../../../src/harness/test-runtime.ts';
import { watchedSink } from './watched-sink.ts';

const entities = {
  member: defineEntity({
    prefix: 'czm',
    dataSubject: 'id',
    fields: { email: field.string().personal() },
  }),
  holder: defineEntity({ prefix: 'czh', fields: { owner: field.subject().optional() } }),
  /** Owned through its holder, a personal value of the owner (so the reference walk finds it) and a secret. */
  item: defineEntity({
    prefix: 'czi',
    dataSubject: 'holderId.owner',
    fields: {
      holderId: field.ref.own('holder'),
      note: field.string().personal(),
      secret: field.secret(),
    },
  }),
  /** Owned through its holder, no personal value: only the lookup of the owned rows finds it. */
  plain: defineEntity({
    prefix: 'czp',
    dataSubject: 'holderId.owner',
    fields: { holderId: field.ref.own('holder'), secret: field.secret() },
  }),
  /** Owned through its holder, holding a personal value of another subject (`aboutId`) and a secret. */
  deed: defineEntity({
    prefix: 'czd',
    dataSubject: 'holderId.owner',
    fields: {
      holderId: field.ref.own('holder'),
      aboutId: field.subject(),
      about: field.string().personal({ subject: 'aboutId' }),
      secret: field.secret(),
    },
  }),
  mark: defineEntity({ prefix: 'czk', fields: { label: field.string() } }),
  /** An owner field that may stay empty, and a personal value of each of two other subjects. */
  memo: defineEntity({
    prefix: 'czo',
    dataSubject: 'owner',
    fields: {
      owner: field.subject().optional(),
      aboutId: field.subject(),
      otherId: field.subject(),
      about: field.string().personal({ subject: 'aboutId' }),
      other: field.string().personal({ subject: 'otherId' }),
      secret: field.secret(),
    },
  }),
};
const base = defineModuleBase({ id: 'cz', version: '0.1.0', entities });
type Kind = keyof typeof entities;
const make = defineCommand(base, {
  input: shape({
    kind: field.string(),
    owner: field.string().optional(),
    holderId: field.string().optional(),
    note: field.string().optional(),
    secret: field.secret().optional(),
    email: field.string().optional(),
    aboutId: field.string().optional(),
    otherId: field.string().optional(),
    about: field.string().optional(),
    other: field.string().optional(),
  }),
  output: shape({ id: field.string() }),
  principal: 'operator',
  *decide(input, ctx) {
    const kind = input.kind as Kind;
    const id = yield* ctx.newId(entities[kind]);
    const values: Record<string, unknown> = { id };
    for (const name of [
      'owner',
      'holderId',
      'note',
      'secret',
      'email',
      'aboutId',
      'otherId',
      'about',
      'other',
    ] as const) {
      if (input[name] !== undefined) values[name] = input[name];
    }
    const write = (ctx.write.cz as never as Record<string, { create(v: unknown): never }>)[kind];
    return { events: [write?.create(values) as never], result: { id } };
  },
});
/** Hands a holder (or, with `kind`, a row of that entity) to another subject, or clears its owner. */
const give = defineCommand(base, {
  input: shape({
    id: field.string(),
    owner: field.string().optional(),
    kind: field.string().optional(),
  }),
  principal: 'operator',
  *decide(input, ctx) {
    const kind = input.kind ?? 'holder';
    const load = (
      ctx.load.cz as never as Record<string, { one(q: unknown): Generator<never, unknown> }>
    )[kind];
    const write = (
      ctx.write.cz as never as Record<string, { update(r: unknown, v: unknown): never }>
    )[kind];
    const row = yield* load?.one({ where: { id: input.id } }) as Generator<never, unknown>;
    return row === undefined ? [] : [write?.update(row, { owner: input.owner ?? null }) as never];
  },
});
const ping = defineCommand(base, {
  input: shape({ label: field.string() }),
  principal: 'user',
  *decide(input, ctx) {
    const id = yield* ctx.newId(entities.mark);
    return [ctx.write.cz.mark.create({ id, label: input.label })];
  },
});
const cz = defineModule(base, {
  actions: { make, give, ping },
  policies: {
    make: { operator: defineRule(base, make, { effect: 'allow', principal: 'operator' }) },
    give: { operator: defineRule(base, give, { effect: 'allow', principal: 'operator' }) },
    ping: { user: defineRule(base, ping, { effect: 'allow', principal: 'user' }) },
  },
});
const uuid = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/;
export const clearedApp = defineApp({ id: 'erasure-cleared', modules: [cz] });

/** The id of the value key a stored secret names. */
export const keyOf = (stored: unknown): string =>
  uuid.exec(JSON.stringify(stored ?? ''))?.[1] ?? '';

/** What a case may hang on: `run` in the sink that takes the tombstone of `key`, `after` and `inside` in the erasure's steps. */
export interface Hooks {
  key?: string;
  run?: () => Promise<void>;
  /** A sink that is down for the records it names: it throws before it takes them. */
  refuse?: (record: LedgerRecord) => boolean;
  after?: (step: ErasureStep) => Promise<void>;
  inside?: (step: ErasureStep, record: ErasureRecord) => Promise<void>;
}

/** A tenant with ada and bea, the erasure worker with its hooks and what a case reads back. */
export async function bootCleared(running: TestRuntime<typeof clearedApp>[]) {
  const hook: Hooks = {};
  const taken: LedgerRecord[] = [];
  const sink = watchedSink(async (records: readonly LedgerRecord[]) => {
    if (records.some((r) => hook.refuse?.(r) === true)) throw new Error('the sink is down');
    taken.push(...records);
    if (!records.some((r) => r.type === 'keyTombstone' && r.keyId === hook.key)) return;
    const { run } = hook;
    delete hook.run;
    await run?.();
  });
  const worker = erasure({
    pollMs: 3_600_000,
    afterStep: async (step) => hook.after?.(step),
    insideStep: async (step, record) => hook.inside?.(step, record),
  });
  const runtime = await startTestRuntime(clearedApp, {
    adapter: 'memory',
    operators: true,
    workers: true,
    tenants: ['acme'],
    eventWorkers: [worker],
    ledgers: [sink],
  });
  running.push(runtime);
  const { acme } = runtime.tenants;
  const scope: Scope = { level: 'tenant', backendId: runtime.backendId, tenantId: acme.id };
  const operator = createLocalClient(runtime, { principal: testOperator(), tenant: 'acme' });
  const rowOf = async (entity: string, id: string) =>
    (
      await runtime.adapter.unit(runtime.namespace, scope, async (unit) => {
        const descriptor = runtime.app.registry.entities.get(entity)?.descriptor;
        if (descriptor === undefined) throw new Error(`no entity ${entity}`);
        return (await unit.rows.find(descriptor, { includeArchived: true, includeErased: true }))
          .rows;
      })
    ).find((row) => row.id === id || row.commandId === id);
  /** What the `erased` event of a row says: the subject, the fields cleared and whether the row was hers. */
  const answerOf = async (entity: string, id: string) =>
    (
      await runtime.adapter.unit(
        runtime.namespace,
        scope,
        (unit) => unit.events.readStream({ type: entity, id }),
        { readOnly: true },
      )
    ).find((event) => event.type === `${entity}.erased`)?.data;
  /** The id of a value key made for a row of an entity that does not exist in the tenant. */
  const keyOfGoneRow = async (entity: string, id: string) =>
    (
      await runtime.adapter.unit(runtime.namespace, scope, (unit) =>
        unit.keys.sealValue({ entity, id, field: 'secret' }, new TextEncoder().encode('gone')),
      )
    ).keyId;
  const mk = async (input: Record<string, unknown>): Promise<string> =>
    String(((await operator.invoke('cz.make', input as never)) as { id: string }).id);
  const opens = async (key: string) =>
    (await runtime.adapter.unit(runtime.namespace, scope, (unit) => unit.keys.liveValueKeys([key])))
      .length === 1;
  const inLedger = async (key: string) =>
    (
      await runtime.control.adapter.unit(
        runtime.control.namespace,
        { level: 'deployment' },
        (unit) => unit.ledger?.since(0n, 100_000) ?? Promise.resolve([]),
        { readOnly: true },
      )
    ).some(({ record }) => record.type === 'keyTombstone' && record.keyId === key);
  const inSink = (key: string) => taken.some((r) => r.type === 'keyTombstone' && r.keyId === key);
  /** A command of `subject` through the principal id `principalId` (as a session row of hers would be). */
  const ping = async (subject: string, principalId: string) => {
    const commandId = crypto.randomUUID();
    const result = await runtime.invoker.invoke({
      action: 'cz.ping',
      input: { label: 'ping' },
      carrier: testCarrier(acme, testPrincipal(subject, { principalId })),
      requestId: crypto.randomUUID(),
      signal: new AbortController().signal,
      commandId,
    });
    return { commandId, result };
  };
  const ledger = createControlLedger(runtime.control.adapter, runtime.control.namespace);
  /** The command id of the erasure record of a subject (the first record when none is named) in the control ledger. */
  const erasureCommand = async (subject?: string): Promise<string | undefined> => {
    for (const { record } of await ledger.since(0n, 1000)) {
      if (
        record.type === 'erasure' &&
        (subject === undefined || String(record.subjectId).toLowerCase() === subject.toLowerCase())
      ) {
        return record.commandId;
      }
    }
    return undefined;
  };
  /** The command ids that the control ledger's tombstones of `key` name, in order ('-' for none). */
  const tombstonesOf = async (key: string): Promise<string[]> =>
    (await ledger.find([{ type: 'keyTombstone', keyId: key }])).map(({ record }) =>
      record.type === 'keyTombstone' ? (record.commandId ?? '-') : '-',
    );
  /** A tombstone for `keyId` in the control ledger, as an erasure that names `commandId` (another's, or none) would leave it. */
  const plant = (keyId: string, commandId?: string) =>
    ledger.append({
      type: 'keyTombstone',
      scopeId: acme.id,
      keyId,
      recordedAt: Temporal.Now.instant().toString(),
      reason: 'erasure',
      ...(commandId === undefined ? {} : { commandId }),
    });
  const ada = await mk({ kind: 'member', email: 'ada@example.test' });
  const bea = await mk({ kind: 'member', email: 'bea@example.test' });
  const request = async (subject: string = ada) => {
    await operator.invoke(
      'core.eraseSubject',
      { subjectId: subject as never, reason: 'subjectRequest' } as never,
      { prefer: 'async' },
    );
    await runtime.drainJobs();
  };
  /** One pass of the erasure worker, then the jobs settle: how many erasures it finished. */
  const once = async () => {
    const finished = await worker.pass();
    await runtime.drainJobs();
    return finished;
  };
  /** Runs the erasure's passes until one finishes, then lets the jobs settle. */
  const finish = async () => {
    let finished = await worker.pass();
    for (let again = 0; again < 3 && finished === 0; again += 1) finished += await worker.pass();
    await runtime.drainJobs();
    return finished;
  };
  return {
    hook,
    operator,
    rowOf,
    answerOf,
    keyOfGoneRow,
    mk,
    opens,
    inLedger,
    inSink,
    erasureCommand,
    tombstonesOf,
    plant,
    ping,
    request,
    once,
    finish,
    ada,
    bea,
  };
}
