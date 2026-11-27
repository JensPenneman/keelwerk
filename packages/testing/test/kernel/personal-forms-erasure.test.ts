import {
  defineApp,
  defineCommand,
  defineEntity,
  defineModule,
  defineModuleBase,
  defineProcess,
  defineRule,
  defineStream,
  field,
  openStoredEvents,
  openStoredRecords,
  shape,
} from '@keelwerk/core';
import { consumers, erasure, reactionDispatcher } from '@keelwerk/events';
import { afterAll, describe, expect, test } from 'vitest';
import { createLocalClient } from '../../src/harness/create-local-client.ts';
import { startTestRuntime } from '../../src/harness/start-test-runtime.ts';
import { testOperator } from '../../src/harness/test-operator.ts';
import { dumpDatabase } from '../../src/index.ts';
import { pgliteQuery, sectionsOf } from './support/dump-sections.ts';

// The one allowed form: a top-level member marked personal as a whole, whatever its type.
const forms = {
  scalar: () => field.string().personal(),
  list: () => field.list(field.string()).personal(),
  json: () => field.json(shape({ e: field.string() })).personal(),
};
const members = () => ({ scalar: forms.scalar(), list: forms.list(), json: forms.json() });
const sites = ['ROW', 'EVENT', 'STREAM', 'PROC'] as const;
const marker = (site: string, form: string) => `FORM-${site}-${form.toUpperCase()}`;
const valuesOf = (site: string) => ({
  scalar: marker(site, 'scalar'),
  list: [marker(site, 'list')],
  json: { e: marker(site, 'json') },
});

const person = defineEntity({
  prefix: 'pfx',
  dataSubject: 'id',
  fields: { name: field.string({ maxLength: 100 }), ...members() },
  events: { noted: shape(members()) },
  evolve: { noted: (state: object) => state },
} as never);
const log = defineStream({
  key: field.ref.own('person'),
  record: shape(members()),
  readAs: 'person',
} as never);
const base = defineModuleBase({
  id: 'pf',
  version: '0.1.0',
  entities: { person },
  streams: { log },
} as never);
type Ctx = {
  newId: (entity: unknown) => Generator<unknown, string>;
  write: {
    pf: {
      person: { create: (v: object) => unknown };
      log: { append: (id: string, r: object[]) => unknown };
    };
  };
  events: Record<string, (v: object) => unknown>;
};
const enrol = defineCommand(
  base as never,
  {
    input: shape({}),
    output: shape({ id: field.ref.own('person') }),
    principal: 'operator',
    *decide(_input: unknown, ctx: never) {
      const c = ctx as Ctx;
      const id = yield* c.newId(person);
      return {
        events: [
          c.write.pf.person.create({ id, name: 'ada', ...valuesOf('ROW') }),
          c.write.pf.log.append(id, [valuesOf('STREAM')]),
        ],
        result: { id },
      };
    },
  } as never,
);
const note = defineCommand(
  base as never,
  person as never,
  {
    input: shape({}),
    decide: (_i: unknown, _current: unknown, ctx: never) => [
      (ctx as Ctx).events.noted?.(valuesOf('EVENT')),
    ],
  } as never,
);
const watch = defineProcess(
  base as never,
  {
    on: ['pf.person.noted'],
    key: (event: { stream: { id: string } }) => event.stream.id,
    dataSubject: 'instanceKey',
    events: { seen: shape(members()) },
    initial: { n: 0 },
    evolve: (state: { n: number }) => ({ n: state.n + 1 }),
    react(_event: unknown, _state: unknown, ctx: never) {
      return [(ctx as Ctx).events.seen?.(valuesOf('PROC'))];
    },
  } as never,
);
const allow = (action: object) =>
  defineRule(base as never, action as never, { effect: 'allow', principal: 'operator' } as never);
const mod = defineModule(
  base as never,
  {
    actions: { enrol },
    entityActions: { person: { note } },
    reactions: { watch },
    policies: {
      enrol: { o: allow(enrol) },
      person: {
        o: defineRule(
          base as never,
          person as never,
          {
            effect: 'allow',
            actions: ['read', 'write', 'note'],
            principal: 'operator',
            reason: 'probe',
          } as never,
        ),
      },
    },
  } as never,
);
const app = defineApp({ id: 'pf-app', modules: [mod] as never });

type Booted = Awaited<ReturnType<typeof boot>>;
let booted: Booted | undefined;
afterAll(async () => booted?.runtime.stop());

async function boot() {
  const worker = erasure({ pollMs: 3_600_000 });
  const dispatcher = consumers({ consumers: [reactionDispatcher()], runs: ['asyncReactions'] });
  const runtime = (await startTestRuntime(
    app as never,
    {
      adapter: 'pglite',
      operators: true,
      workers: true,
      eventWorkers: [dispatcher, worker],
    } as never,
  )) as never as {
    adapter: never;
    sealed: {
      unit: (ns: unknown, s: unknown, f: (u: never) => Promise<string>) => Promise<string>;
    };
    namespace: unknown;
    backendId: string;
    tenants: { acme: { id: string } };
    drainJobs: () => Promise<number>;
    stop: () => Promise<void>;
  };
  const operator = createLocalClient(runtime as never, {
    principal: testOperator(),
    tenant: 'acme',
  }) as never as {
    invoke: (a: string, i: unknown, o?: object) => Promise<{ id: string }>;
  };
  const made = await operator.invoke('pf.enrol', {});
  await operator.invoke('pf.person.note', { id: made.id });
  await dispatcher.settled();
  await runtime.drainJobs();
  await dispatcher.settled();
  await runtime.drainJobs();
  const scope = {
    level: 'tenant',
    backendId: runtime.backendId,
    tenantId: runtime.tenants.acme.id,
  };
  const descriptor = (
    app as never as { registry: { entities: Map<string, { descriptor: unknown }> } }
  ).registry.entities.get('pf.person')?.descriptor;
  const readBack = () =>
    runtime.sealed.unit(runtime.namespace, scope, async (unit: never) => {
      const u = unit as never as {
        rows: { find: (d: unknown, o: object) => Promise<{ rows: unknown[] }> };
        events: { readAll: (a: null, o: object) => Promise<{ events: unknown[] }> };
        streams: { read: (s: string, k: string, a: null, n: number) => Promise<unknown[]> };
      };
      const rows = (await u.rows.find(descriptor, { includeArchived: true, includeErased: true }))
        .rows;
      const events = (await u.events.readAll(null, { limit: 1000, includeTransient: true })).events;
      const opened = await openStoredEvents(unit as never, events as never);
      const records = await openStoredRecords(
        unit as never,
        {
          stream: 'pf.log',
          key: made.id,
          personal: ['scalar', 'list', 'json'],
          records: await u.streams.read('pf.log', made.id, null, 10),
        } as never,
      );
      return JSON.stringify(
        { rows, opened: opened.map((e: { data: unknown }) => e.data), records },
        (_k, v: unknown) =>
          typeof v === 'bigint'
            ? v.toString()
            : v instanceof Uint8Array
              ? Buffer.from(v).toString('utf8')
              : v,
      );
    });
  const dump = async () => dumpDatabase(pgliteQuery(runtime.adapter));
  const where = (text: string, m: string) =>
    [...sectionsOf(text)].filter(([, rows]) => rows.includes(m)).map(([name]) => name);
  return { runtime, operator, made, readBack, dump, where, worker };
}

describe('a top-level member marked personal as a whole is sealed and erased (PGlite)', () => {
  const cases = sites.flatMap((site) => Object.keys(forms).map((form) => [site, form] as const));

  test('before the erasure: stored sealed, read by the kernel', { timeout: 240_000 }, async () => {
    booted = await boot();
    const plain = await booted.dump();
    const read = await booted.readBack();
    for (const [site, form] of cases) {
      const m = marker(site, form);
      expect({ m, plain: booted.where(plain, m) }).toEqual({ m, plain: [] });
      expect({ m, read: read.includes(m) }).toEqual({ m, read: true });
    }
  });

  test('after the erasure of the subject: still sealed, unreadable', {
    timeout: 240_000,
  }, async () => {
    if (booted === undefined) throw new Error('the first case boots');
    const { runtime, operator, made, readBack, dump, where, worker } = booted;
    await operator.invoke(
      'core.eraseSubject',
      { subjectId: made.id, reason: 'subjectRequest' },
      { prefer: 'async' },
    );
    await runtime.drainJobs();
    await worker.pass();
    await runtime.drainJobs();
    const plain = await dump();
    const read = await readBack();
    for (const [site, form] of cases) {
      const m = marker(site, form);
      expect({ m, plain: where(plain, m) }).toEqual({ m, plain: [] });
      expect({ m, read: read.includes(m) }).toEqual({ m, read: false });
    }
  });
});
