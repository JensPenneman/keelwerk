import type {
  ActionEntry,
  Clock,
  CommandResult,
  DataAdapter,
  EntityBehaviours,
  Invoker,
  Principal,
  Receipt,
  Registry,
  RuleEntry,
  StorageRow,
  StoredEvent,
  Unit,
} from '@keelwerk/core';
import {
  createCommandRunner,
  entityBehavioursOf,
  field,
  KeelwerkError,
  normalizeRule,
  runCommand,
  shape,
} from '@keelwerk/core';
import { conformanceApp } from '../../../src/fixtures/index.ts';
import { ada, base, call, kit } from './invoker-kit.ts';
import { clock, namespace, open, silent, tenant, userOf } from './run-read-kit.ts';

const served: Registry = {
  ...conformanceApp.registry,
  fills: new Map([...conformanceApp.registry.fills, ...base.fills]),
};

const entityOf = (ref: string) => {
  const entry = served.entities.get(ref);
  if (entry === undefined) throw new Error(`the conformance fixture has no ${ref}`);
  return entry.descriptor;
};

/** The book and loan descriptors of the conformance fixture (the book carries the contributed `reservedBy`). */
export const bookEntity = entityOf('library.book');
export const loanEntity = entityOf('loans.loan');
export const behaviours: EntityBehaviours = entityBehavioursOf(conformanceApp.modules);

export interface CommandKit {
  readonly adapter: DataAdapter;
  readonly invoker: Invoker;
}

/** An invoker over the conformance fixture and the in-memory adapter with the write path wired in. */
export function commandKit(
  over: {
    readonly registry?: Registry;
    readonly adapter?: DataAdapter;
    readonly behaviours?: EntityBehaviours;
    /** The clock of the adapter and of the invoker; default: the fixed fixture instant. */
    readonly clock?: Clock;
  } = {},
): CommandKit {
  const adapter = over.adapter ?? open([bookEntity, loanEntity], over.clock);
  const chosen = over.behaviours ?? behaviours;
  return kit({
    registry: over.registry ?? served,
    adapter,
    ...(over.clock === undefined ? {} : { clock: over.clock }),
    commands: createCommandRunner({
      deploymentId: '0198a1e0-0000-7000-8000-00000000d001',
      behaviours: () => chosen,
      retry: { sleep: async () => undefined },
    }),
  });
}

/** The fixture registry with `ref` cloned from `from` under a handler the test writes. */
export function withCommand(
  name: string,
  handler: ActionEntry['handler'],
  from: string,
  over: Partial<ActionEntry> = {},
  rules?: ReadonlyMap<string, RuleEntry>,
): { readonly registry: Registry; readonly ref: string } {
  const source = served.actions.get(from);
  if (source === undefined) throw new Error(`no ${from} in the fixture`);
  const ref = `${source.module}.${name}`;
  const { principal: _principal, ...rest } = source;
  const action: ActionEntry = {
    ...rest,
    ref,
    name,
    auth: 'public',
    handler,
    input: shape({ bookId: field.string().optional() }),
    output: shape({}),
    ...over,
  };
  return {
    ref,
    registry: {
      ...served,
      ...(rules === undefined ? {} : { rules }),
      actions: new Map([...served.actions, [ref, action]]),
    },
  };
}

export const rules = served.rules;

/** Adds books through `addBook` (so each has the stream its version says) and answers their ids. */
export async function addBooks(adapter: DataAdapter, count: number): Promise<readonly string[]> {
  const ids: string[] = [];
  for (let n = 1; n <= count; n += 1) {
    const result = await runDirect({
      adapter,
      action: 'library.addBook',
      input: { title: `Book ${n}`, isbn: `isbn-${n}` },
    });
    ids.push((result.output as { bookId: string }).bookId);
  }
  return ids;
}

/** Invokes a command through the pipeline as `ada`: the output on success, the error thrown on failure. */
export async function invokeAsAda(
  invoker: Invoker,
  action: string,
  input: unknown,
  commandId?: string,
): Promise<{ readonly output: unknown; readonly replayed: true | undefined }> {
  const outcome = await invoker.invoke(
    call(action, input, { carrier: ada, ...(commandId === undefined ? {} : { commandId }) }),
  );
  if (!outcome.ok) throw outcome.error;
  return { output: outcome.value, replayed: outcome.replayed };
}

/** Runs a command straight through the write path, below the pipeline's gate. */
export function runDirect(over: {
  readonly registry?: Registry;
  readonly adapter: DataAdapter;
  readonly action: string;
  readonly input: unknown;
  readonly commandId?: string;
  readonly principal?: Principal;
  readonly behaviours?: EntityBehaviours;
  readonly signal?: AbortSignal;
  readonly concurrentUnits?: boolean;
}): Promise<CommandResult> {
  const registry = over.registry ?? served;
  const action = registry.actions.get(over.action);
  if (action === undefined) throw new Error(`no ${over.action} in the fixture`);
  return runCommand({
    registry,
    adapter: over.adapter,
    namespace,
    scope: tenant,
    action,
    input: over.input,
    principal: over.principal ?? userOf('ada'),
    request: { transport: 'test', requestId: 'req-1' },
    clock,
    keys: {} as never,
    compute: {} as never,
    log: silent,
    trace: {} as never,
    rules: [...registry.rules.values()].filter((rule) => rule.disabled !== true).map(normalizeRule),
    apiVersion: '2026-11-04',
    build: { id: 'test', revision: 1 },
    behaviours: over.behaviours ?? behaviours,
    concurrentUnits: over.concurrentUnits ?? true,
    retry: { sleep: async () => undefined },
    ...(over.commandId === undefined ? {} : { commandId: over.commandId }),
    ...(over.signal === undefined ? {} : { signal: over.signal }),
  });
}

export interface Snapshot {
  readonly books: readonly StorageRow[];
  readonly events: readonly StoredEvent[];
  readonly receipt: Receipt | undefined;
}

/** The rows of the book table, the events of one book and the receipt of a command, read in one unit. */
export async function snapshot(
  adapter: DataAdapter,
  bookId?: string,
  commandId?: string,
): Promise<Snapshot> {
  return adapter.unit(namespace, tenant, async (unit) => ({
    books: (await unit.rows.find(bookEntity, {})).rows,
    events:
      bookId === undefined
        ? []
        : await unit.events.readStream({ type: 'library.book', id: bookId }),
    receipt: commandId === undefined ? undefined : await unit.receipts.get(commandId),
  }));
}

/** The members of a decide context these tests reach, untyped beyond what they call. */
export interface WriteContext {
  readonly load: {
    readonly library: {
      readonly book: { byId(id: string): Generator<never, { readonly version: number }, unknown> };
    };
  };
  readonly write: {
    readonly library: {
      readonly book: { update(target: unknown, patch: Record<string, unknown>): unknown };
    };
  };
}

/** Wraps an adapter: counts the attempts of commands (units that claim a receipt) and fails the first `fails` appends with a version conflict. */
export function flaky(
  inner: DataAdapter,
  fails: number,
): { adapter: DataAdapter; units: () => number } {
  let opened = 0;
  let left = fails;
  const wrap = (unit: Unit): Unit => ({
    ...unit,
    receipts: {
      ...unit.receipts,
      claim: async (receipt) => {
        opened += 1;
        return unit.receipts.claim(receipt);
      },
    },
    events: {
      ...unit.events,
      append: async (batch) => {
        if (left > 0) {
          left -= 1;
          throw new KeelwerkError({
            kind: 'conflict',
            code: 'core.version_mismatch',
            message: 'The stream changed since it was read.',
          });
        }
        return unit.events.append(batch);
      },
    },
  });
  return {
    units: () => opened,
    adapter: {
      ...inner,
      unit: (ns, scope, fn, options) => inner.unit(ns, scope, (unit) => fn(wrap(unit)), options),
    },
  };
}
