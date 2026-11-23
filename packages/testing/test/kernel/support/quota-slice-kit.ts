import type { Carrier, DataAdapter, DataAdapterFactory, Invoker, StoredJob } from '@keelwerk/core';
import {
  cancelTimer,
  defineApp,
  defineCommand,
  defineEntity,
  defineModule,
  defineModuleBase,
  defineRule,
  enqueue,
  field,
  setTimer,
  shape,
  targetingRefreshMs,
} from '@keelwerk/core';
import { memoryAdapter } from '@keelwerk/data';
import { onTestFinished } from 'vitest';
import { startTestRuntime } from '../../../src/harness/start-test-runtime.ts';
import { testCarrier } from '../../../src/harness/test-carrier.ts';
import { testPrincipal } from '../../../src/harness/test-principal.ts';
import type { TestRuntimeOptions } from '../../../src/harness/test-runtime-options.ts';
import { movableClock } from './movable-clock.ts';

const note = defineEntity({ prefix: 'sln', fields: { text: field.string({ maxLength: 80 }) } });
const sliceBase = defineModuleBase({ id: 'slice', version: '0.1.0', entities: { note } });

/** A write: what the storage quota and the request rate are tried on. */
const add = defineCommand(sliceBase, {
  input: shape({ text: field.string({ maxLength: 80 }) }),
  output: shape({ id: field.ref.own('note') }),
  principal: 'user',
  *decide(input, ctx) {
    const id = yield* ctx.newId(note);
    return { events: [ctx.write.slice.note.create({ id, text: input.text })], result: { id } };
  },
});

/** A command that runs as a job: asked with `prefer: 'async'` it is accepted and waits in `commands`. */
const work = defineCommand(sliceBase, {
  input: shape({}),
  output: shape({}),
  principal: 'user',
  execution: 'async',
  decide() {
    return { events: [], result: {} };
  },
});

/** Enqueues a job for later: it waits in `commands` and counts against the queued cap all the same. */
const later = defineCommand(sliceBase, {
  input: shape({}),
  output: shape({}),
  principal: 'user',
  decide(_input, ctx) {
    return {
      events: [],
      effects: [enqueue(work, {}, { runAt: ctx.clock.now().add({ hours: 1 }) })],
      result: {},
    };
  },
});

/** A command that enqueues itself, `left` more times: a loop with an end the case can count to. */
const loop = defineCommand(sliceBase, {
  input: shape({ left: field.integer() }),
  output: shape({}),
  principal: 'user',
  execution: 'async',
  decide(input) {
    return {
      events: [],
      effects: input.left > 0 ? [enqueue('slice.loop', { left: input.left - 1 })] : [],
      result: {},
    };
  },
});

/** Starts `count` loops of `left` more runs in one decision: all of them become takeable with one commit. */
const spawn = defineCommand(sliceBase, {
  input: shape({ count: field.integer(), left: field.integer() }),
  output: shape({}),
  principal: 'user',
  decide(input) {
    return {
      events: [],
      effects: Array.from({ length: input.count }, () =>
        enqueue('slice.loop', { left: input.left }),
      ),
      result: {},
    };
  },
});

/** A timer loop: each run sets the next timer, `left` more times, under the key of the other parity (a timer under the key of the job that runs replaces and cancels it). */
const ticker = defineCommand(sliceBase, {
  input: shape({ left: field.integer() }),
  output: shape({}),
  principal: ['user', 'service'],
  execution: 'async',
  decide(input) {
    return {
      events: [],
      effects:
        input.left > 0
          ? [
              setTimer({
                key: `tick-${input.left % 2}`,
                after: '0s',
                invoke: 'slice.ticker',
                input: { left: input.left - 1 },
              }),
            ]
          : [],
      result: {},
    };
  },
});

/** Parks a timer under its own key, due in an hour: a timer that waits far ahead and counts against the cap. */
const park = defineCommand(sliceBase, {
  input: shape({ n: field.integer() }),
  output: shape({}),
  principal: 'user',
  decide(input, ctx) {
    return {
      events: [],
      effects: [
        setTimer({
          key: `park-${input.n}`,
          at: ctx.clock.now().add({ hours: 1 }),
          invoke: 'slice.ticker',
          input: { left: 0 },
        }),
      ],
      result: {},
    };
  },
});

/** Cancels the timer that `park` set under the same number. */
const unpark = defineCommand(sliceBase, {
  input: shape({ n: field.integer() }),
  output: shape({}),
  principal: 'user',
  decide(input) {
    return { events: [], effects: [cancelTimer(`park-${input.n}`)], result: {} };
  },
});

const user = { effect: 'allow', principal: 'user' } as const;
const slice = defineModule(sliceBase, {
  actions: { add, work, later, loop, spawn, ticker, park, unpark },
  policies: {
    add: { open: defineRule(sliceBase, add, user) },
    work: { open: defineRule(sliceBase, work, user) },
    later: { open: defineRule(sliceBase, later, user) },
    loop: { open: defineRule(sliceBase, loop, user) },
    spawn: { open: defineRule(sliceBase, spawn, user) },
    park: { open: defineRule(sliceBase, park, user) },
    unpark: { open: defineRule(sliceBase, unpark, user) },
    ticker: {
      open: defineRule(sliceBase, ticker, user),
      service: defineRule(sliceBase, ticker, { effect: 'allow', principal: 'service' }),
    },
  },
});

const sliceApp = defineApp({ id: 'quota-slice', modules: [slice] as const });

const operatorCarrier: Carrier = { transport: 'test', local: { inProcess: true } };

/** One thing the job store was asked, in the order the store saw it. */
interface StoreOp {
  readonly op: 'enqueue' | 'take' | 'complete';
  /** The tenant the job belongs to. */
  readonly tenant: string;
  /** The queue the job is in. */
  readonly queue: string;
}

/**
 * The in-memory adapter whose job store logs each enqueue, take and completion in one list, in
 * order. `hold`, when given, is awaited before each enqueue is made, with the tenant it is for: a
 * test keeps a command inside its unit there.
 */
function loggedStore(log: StoreOp[], hold?: (tenant: string) => Promise<void>): DataAdapterFactory {
  const base = memoryAdapter({
    entities: (ref) => sliceApp.registry.entities.get(ref)?.descriptor,
  });
  const tenantOf = (scope: { readonly level: string; readonly tenantId?: string }): string =>
    scope.tenantId ?? scope.level;
  return {
    ...base,
    create: (placement, env): DataAdapter => {
      const adapter = base.create(placement, env);
      const owners = new Map<string, string>();
      return {
        ...adapter,
        unit: (namespace, scope, fn, options) =>
          adapter.unit(
            namespace,
            scope,
            (unit) =>
              fn({
                ...unit,
                jobs: {
                  ...unit.jobs,
                  enqueue: async (job) => {
                    await hold?.(tenantOf(job.scope));
                    const id = await unit.jobs.enqueue(job);
                    log.push({ op: 'enqueue', tenant: tenantOf(job.scope), queue: job.queue });
                    return id;
                  },
                  take: async (queue, worker, request) => {
                    const taken = await unit.jobs.take(queue, worker, request);
                    for (const job of taken.jobs as readonly StoredJob[]) {
                      owners.set(
                        `${job.attempt.jobId}`,
                        `${tenantOf(job.scope)}\u0000${job.queue}`,
                      );
                      log.push({ op: 'take', tenant: tenantOf(job.scope), queue: job.queue });
                    }
                    return taken;
                  },
                  complete: async (attempt, worker, outcome) => {
                    const done = await unit.jobs.complete(attempt, worker, outcome);
                    const [tenant = 'unknown', queue = 'unknown'] = (
                      owners.get(`${attempt.jobId}`) ?? ''
                    ).split('\u0000');
                    if (done) log.push({ op: 'complete', tenant, queue });
                    return done;
                  },
                },
              }),
            options,
          ),
      };
    },
  };
}

async function bootSlice(
  options: TestRuntimeOptions<'acme' | 'globex'> & {
    readonly log?: StoreOp[];
    /** Awaited before each enqueue of the job store, with the tenant it is for (see `loggedStore`). */
    readonly hold?: (tenant: string) => Promise<void>;
    /** The slice app with a resolver of the test's own added. */
    readonly app?: typeof sliceApp;
  } = {},
) {
  const { log, hold, app = sliceApp, ...rest } = options;
  const moving = movableClock('2026-11-22T08:00:00Z');
  const runtime = await startTestRuntime(app, {
    operators: true,
    tenants: ['acme', 'globex'],
    clock: moving.clock,
    ...(log === undefined && hold === undefined
      ? {}
      : { external: { factory: loggedStore(log ?? [], hold), url: 'memory://quota-slice' } }),
    ...rest,
  });
  onTestFinished(() => runtime.stop());
  // The start writes the limits of `config.core.quotas` to the control store, and the quota cache
  // reads them when its feed wakes or when its rows are older than the bound: the clock moves past
  // it, so the first request reads them whichever of the two comes first.
  moving.step(targetingRefreshMs + 1);
  // From here the clock stands still until a case moves it (`setFreshLimit` does).
  return Object.assign(runtime, { step: moving.step });
}

type SliceRuntime = Awaited<ReturnType<typeof bootSlice>>;

/** `core.quota.set` of one dimension for one tenant over the in-process operator. */
function setTenantLimit(
  runtime: { readonly invoker: Invoker; readonly backendId: string },
  tenantId: string,
  dimension: string,
  limit: string,
) {
  return runtime.invoker.invoke<unknown, { id: string }>({
    action: 'core.quota.set',
    input: { dimension, backendId: runtime.backendId, tenantId, limit, reason: 'the slice test' },
    carrier: operatorCarrier,
    requestId: crypto.randomUUID(),
    commandId: crypto.randomUUID(),
    signal: new AbortController().signal,
  });
}

/**
 * `setTenantLimit`, then the case's clock moves past the refresh bound of the quota cache. The
 * cache follows the control feed, but a request that comes while a reload is still running joins
 * that reload and may read the rows from before the set. The step makes the reload old by a bound,
 * so the cache loads once more for each request that joined it (and a request that comes with no
 * reload running loads at once), whichever of the feed's wake and the requests comes first.
 */
async function setFreshLimit(
  runtime: {
    readonly invoker: Invoker;
    readonly backendId: string;
    readonly step: (ms: number) => void;
  },
  tenantId: string,
  dimension: string,
  limit: string,
) {
  const set = await setTenantLimit(runtime, tenantId, dimension, limit);
  runtime.step(targetingRefreshMs + 1);
  return set;
}

/** One call as the tenant's user. */
function callAs(
  runtime: SliceRuntime,
  tenant: 'acme' | 'globex',
  action: string,
  input: unknown = {},
  prefer?: 'async',
) {
  return runtime.invoker.invoke<unknown, Record<string, unknown>>({
    action,
    input,
    carrier: testCarrier(runtime.tenants[tenant], testPrincipal('ada')),
    requestId: crypto.randomUUID(),
    ...(prefer === undefined ? {} : { prefer, commandId: crypto.randomUUID() }),
    signal: new AbortController().signal,
  });
}

export type { SliceRuntime, StoreOp };
export { bootSlice, callAs, loggedStore, setFreshLimit, setTenantLimit, sliceApp };
