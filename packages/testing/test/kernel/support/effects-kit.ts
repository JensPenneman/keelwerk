import type {
  ActionEntry,
  DataAdapter,
  EffectEntry,
  ExecutorEntry,
  ReactionEntry,
  Registry,
  Scope,
  StorageRow,
  StoredEvent,
  StoredJobSpec,
  Unit,
} from '@keelwerk/core';
import { createCommandRunner, field, KeelwerkError, shape } from '@keelwerk/core';
import { conformanceApp } from '../../../src/fixtures/index.ts';
import { behaviours, bookEntity, loanEntity } from './command-kit.ts';
import { ada, base, call, kit } from './invoker-kit.ts';
import { namespace, open, tenant } from './run-read-kit.ts';

/** The conformance fixture with the test principal resolver, as the command kit serves it. */
const servedRegistry: Registry = {
  ...conformanceApp.registry,
  fills: new Map([...conformanceApp.registry.fills, ...base.fills]),
};

const effectEntry = servedRegistry.entities.get('core.effect');
if (effectEntry === undefined) throw new Error('the fixture has no core.effect');
function invoker(registry: Registry, adapter: DataAdapter) {
  const built = kit({
    registry,
    adapter,
    build: { id: 'build-42', revision: 7 },
    commands: createCommandRunner({
      behaviours: () => behaviours,
      retry: { sleep: async () => undefined },
    }),
  });
  return (
    action: string,
    input: unknown,
    options: { readonly commandId?: string; readonly prefer?: 'sync' | 'async' } = {},
  ) =>
    built.invoker.invoke(
      call(action, input, {
        carrier: ada,
        ...(options.commandId === undefined ? {} : { commandId: options.commandId }),
        ...(options.prefer === undefined ? {} : { prefer: options.prefer }),
      }),
    );
}

/** Takes every due job of the queues (the in-memory store leases them; a test reads once). */
async function jobsOf(unit: Unit, queues: readonly string[]): Promise<readonly StoredJobSpec[]> {
  const taken: StoredJobSpec[] = [];
  for (const queue of queues) {
    const result = await unit.jobs.take(queue, 'test', {
      limit: 50,
      capabilitySets: ['', 'dns', 'smtp-out'],
      maxRevision: 100,
      leaseMs: 1000,
    });
    taken.push(...result.jobs);
  }
  return taken;
}

export const effectEntity = effectEntry.descriptor;

/** What a test adds to the fixture's registry. */
export interface Parts {
  readonly actions?: readonly ActionEntry[];
  /** Replaces the fixture's reactions (`loans.countLoans` among them) unless `keepReactions`. */
  readonly reactions?: readonly ReactionEntry[];
  readonly keepReactions?: boolean;
  readonly effects?: readonly EffectEntry[];
  readonly executors?: readonly ExecutorEntry[];
}

/** The fixture's registry with the parts added. */
export function registryWith(parts: Parts): Registry {
  return {
    ...servedRegistry,
    actions: new Map([
      ...servedRegistry.actions,
      ...(parts.actions ?? []).map((a) => [a.ref, a] as const),
    ]),
    reactions: new Map([
      ...(parts.keepReactions === true ? servedRegistry.reactions : []),
      ...(parts.reactions ?? []).map((r) => [r.id, r] as const),
    ]),
    effects: new Map((parts.effects ?? []).map((e) => [e.ref, e] as const)),
    executors: new Map((parts.executors ?? []).map((e) => [e.ref, e] as const)),
  };
}

/** A command of the library module that anyone may call, cloned from `addBook`, under a handler the test writes. */
export function command(
  name: string,
  handler: ActionEntry['handler'],
  over: Partial<ActionEntry> = {},
): ActionEntry {
  const source = servedRegistry.actions.get('library.addBook');
  if (source === undefined) throw new Error('no library.addBook in the fixture');
  const { principal: _principal, ...rest } = source;
  return {
    ...rest,
    ref: `library.${name}`,
    name,
    auth: 'public',
    handler,
    input: shape({
      title: field.string().optional(),
      isbn: field.string().optional(),
      n: field.integer().optional(),
    }),
    output: shape({}),
    ...over,
  };
}

/** An inline reaction of a module, with the event it listens to. */
export function reaction(
  id: string,
  on: string,
  react: ReactionEntry['react'],
  over: Partial<ReactionEntry> = {},
): ReactionEntry {
  const module = id.slice(0, id.indexOf('.'));
  return {
    id,
    module,
    on: [on],
    timing: 'inline',
    ordering: 'none',
    coalesce: false,
    process: false,
    react,
    when: [],
    ...over,
  };
}

/** An effect and its executor, declared by the library module. */
export function externalEffect(
  name: string,
  run: ExecutorEntry['run'],
  executor: Partial<ExecutorEntry> = {},
  effect: Partial<EffectEntry> = {},
): { readonly effect: EffectEntry; readonly executor: ExecutorEntry } {
  const ref = `library.${name}`;
  return {
    effect: {
      ref,
      module: 'library',
      name,
      performer: 'executor',
      executor: ref,
      input: shape({ to: field.string() }),
      output: shape({ ok: field.boolean() }),
      ...effect,
    },
    executor: {
      ref,
      module: 'library',
      effect: ref,
      queue: 'effects',
      capability: [],
      inline: false,
      run,
      ...executor,
    },
  };
}

/** An invoker over the fixture, the in-memory adapter and the write path, with the build the jobs record. */
export function effectsKit(
  registry: Registry,
  over: { readonly adapter?: DataAdapter } = {},
): { readonly adapter: DataAdapter; readonly invoke: ReturnType<typeof invoker> } {
  const adapter = over.adapter ?? open([bookEntity, loanEntity, effectEntity]);
  return { adapter, invoke: invoker(registry, adapter) };
}

/** Everything a test reads back of the scope: the books, the effect rows, the events of the books and the jobs. */
export interface Stored {
  readonly books: readonly StorageRow[];
  readonly effects: readonly StorageRow[];
  readonly jobs: readonly StoredJobSpec[];
}

export async function stored(
  adapter: DataAdapter,
  queues: readonly string[] = ['commands', 'timers', 'effects'],
  scope: Scope = tenant,
): Promise<Stored> {
  return adapter.unit(namespace, scope, async (unit) => ({
    books: (await unit.rows.find(bookEntity, {})).rows,
    effects: (await unit.rows.find(effectEntity, {})).rows,
    jobs: await jobsOf(unit, queues),
  }));
}

/** The events of one stream. */
export function eventsOf(
  adapter: DataAdapter,
  type: string,
  id: string,
): Promise<readonly StoredEvent[]> {
  return adapter.unit(namespace, tenant, (unit) => unit.events.readStream({ type, id }));
}

/** The receipt of a command. */
export function receiptOf(adapter: DataAdapter, commandId: string) {
  return adapter.unit(namespace, tenant, (unit) => unit.receipts.get(commandId));
}

/** Wraps an adapter: records every job a unit enqueues, and fails the first `fails` enqueues with a version conflict (a unit the write path repeats). */
export function recordingJobs(
  inner: DataAdapter,
  fails = 0,
): { readonly adapter: DataAdapter; readonly enqueued: StoredJobSpec[] } {
  const enqueued: StoredJobSpec[] = [];
  let left = fails;
  const wrap = (unit: Unit): Unit => ({
    ...unit,
    jobs: {
      ...unit.jobs,
      enqueue: async (job) => {
        enqueued.push(job);
        if (left > 0) {
          left -= 1;
          throw new KeelwerkError({
            kind: 'conflict',
            code: 'core.version_mismatch',
            message: 'The stream changed since it was read.',
          });
        }
        return unit.jobs.enqueue(job);
      },
    },
  });
  return {
    enqueued,
    adapter: {
      ...inner,
      unit: (ns, scope, fn, options) => inner.unit(ns, scope, (unit) => fn(wrap(unit)), options),
    },
  };
}
