import type { ActionEntry, Position, StorageRow } from '@keelwerk/core';
import { createComputePool, entityBehavioursOf, normalizeRule } from '@keelwerk/core';
import { readAsOfPosition, redecide } from '@keelwerk/core/replay';
import { afterEach, describe, expect, test } from 'vitest';
import { runInMemory } from '../../src/drive/run-in-memory.ts';
import { conformanceApp, libraryApp } from '../../src/fixtures/index.ts';
import { testPrincipal } from '../../src/harness/test-principal.ts';
import { expectReproduces } from '../../src/replay/expect-reproduces.ts';
import { tenantAddress } from '../../src/replay/tenant-address.ts';

interface CountContext {
  readonly load: {
    readonly library: { readonly book: { count(): Generator<never, number, unknown> } };
  };
}

type Run = Awaited<ReturnType<typeof runInMemory>>;

const ada = testPrincipal('ada');
const dune = { title: 'Dune', isbn: '978-0441172719' };
const bookId = '00000000-0000-7000-8000-000000000001';
const runs: Run[] = [];

afterEach(async () => {
  await Promise.all(runs.splice(0).map((run) => run.stop()));
});

async function started(...args: Parameters<typeof runInMemory>): Promise<Run> {
  const run = await runInMemory(...args);
  runs.push(run);
  return run;
}

async function redecideWith(
  run: Run,
  over: {
    readonly input: unknown;
    readonly commandId?: string;
    readonly registry?: typeof run.runtime.app.registry;
  },
) {
  const { app } = run.runtime;
  const address = tenantAddress(run.runtime, run.tenant);
  const registry = over.registry ?? app.registry;
  const compute = createComputePool({ size: 1 });
  return redecide({
    registry,
    adapter: run.runtime.adapter,
    namespace: address.namespace,
    scope: address.scope,
    commandId: over.commandId ?? run.commandId,
    input: over.input,
    apiVersion: run.runtime.head,
    behaviours: entityBehavioursOf(app.modules),
    rules: [...registry.rules.values()].filter((rule) => rule.disabled !== true).map(normalizeRule),
    keys: run.runtime.keys,
    compute,
    clock: run.runtime.clock,
    config: run.runtime.config,
    log: run.runtime.log,
    trace: run.runtime.tracer.startSpan('redecide'),
  }).finally(() => compute.close());
}

describe('re-deciding a recorded command', () => {
  test('addBook is reproduced exactly from its stored event (exit criterion 8)', async () => {
    const run = await started(libraryApp, 'library.addBook', { input: dune, principal: ada });
    expect(run.outcome.ok).toBe(true);
    const result = await expectReproduces(run.runtime, { commandId: run.commandId, input: dune });
    expect(result).toMatchObject({ reproduced: true, differences: [], part: 'library.addBook' });
    expect(result.recorded.events).toHaveLength(1);
    expect(result.redecided.events).toEqual(result.recorded.events);
    expect(result.redecided.decision).toEqual(result.recorded.decision);
    expect(result.redecided.result).toEqual(run.outcome.ok ? run.outcome.value : undefined);
  });

  test('it commits nothing: the events and rows are as the command left them', async () => {
    const run = await started(libraryApp, 'library.addBook', { input: dune, principal: ada });
    const before = run.events.length;
    await expectReproduces(run.runtime, { commandId: run.commandId, input: dune });
    const address = tenantAddress(run.runtime, run.tenant);
    const head = await run.runtime.adapter.unit(address.namespace, address.scope, (unit) =>
      unit.events.head(),
    );
    expect(head).toBe(BigInt(before));
    expect(await run.rows('library.book')).toHaveLength(1);
  });

  test('loads are answered as of the recorded position, not from the rows of today', async () => {
    const first = await started(libraryApp, 'library.addBook', { input: dune, principal: ada });
    // The book exists now; at the recorded position it did not, which is why the command could add it.
    expect(await first.rows('library.book')).toHaveLength(1);
    const result = await expectReproduces(first.runtime, {
      commandId: first.commandId,
      input: dune,
    });
    expect(result.recorded.decision.reads).toEqual([{ at: '0' }]);
    expect(result.redecided.decision?.reads).toEqual([{ at: '0' }]);
  });

  test('a command that ran after other commands still re-decides against the past', async () => {
    const run = await started(libraryApp, 'library.addBook', {
      input: { title: 'Emma', isbn: 'isbn-emma' },
      principal: ada,
      rows: { 'library.book': [{ id: bookId, ...dune, addedBy: 'ada' }] },
    });
    expect(run.outcome.ok).toBe(true);
    const input = { title: 'Emma', isbn: 'isbn-emma' };
    const result = await expectReproduces(run.runtime, { commandId: run.commandId, input });
    expect(result.recorded.decision.reads).toEqual([{ at: '1' }]);
  });

  test('an entity command re-decides its target as of the recorded position', async () => {
    const run = await started(conformanceApp, 'library.book.reserve', {
      input: { id: bookId, ifVersion: 1 },
      principal: ada,
      rows: { 'library.book': [{ id: bookId, ...dune, addedBy: 'ada' }] },
    });
    expect(run.outcome.ok).toBe(true);
    const result = await expectReproduces(run.runtime, {
      commandId: run.commandId,
      input: { id: bookId, ifVersion: 1 },
      principal: ada,
    });
    expect(result.recorded.events.map((event) => event.type)).toEqual(['library.book.changed']);
    expect(result.recorded.events[0]?.version).toBe(2);
    expect(result.recorded.decision.reads).toEqual([{ at: '1' }]);
  });

  test('a changed build is reported as differences, not committed', async () => {
    const run = await started(libraryApp, 'library.addBook', { input: dune, principal: ada });
    const { registry } = run.runtime.app;
    const action = registry.actions.get('library.addBook') as ActionEntry;
    const shouting: ActionEntry = {
      ...action,
      handler: (input, ctx) => action.handler({ ...(input as object), title: 'DUNE' }, ctx),
    };
    const result = await redecideWith(run, {
      input: dune,
      registry: { ...registry, actions: new Map([...registry.actions, [action.ref, shouting]]) },
    });
    expect(result.reproduced).toBe(false);
    expect(result.differences).toEqual([
      'event 1 (library.book.created of library.book/' +
        `${result.recorded.events[0]?.stream.split('/')[1]}): data differs`,
    ]);
    expect(result.redecided.events[0]?.data).toMatchObject({ values: { title: 'DUNE' } });
  });

  test('a handler that now fails is a difference with the error code', async () => {
    const run = await started(libraryApp, 'library.addBook', { input: dune, principal: ada });
    const { registry } = run.runtime.app;
    const action = registry.actions.get('library.addBook') as ActionEntry;
    const failing: ActionEntry = {
      ...action,
      handler: function* (input, ctx) {
        // A load the record does not hold: the second read.
        yield* (ctx as CountContext).load.library.book.count();
        return yield* action.handler(input, ctx) as Generator<never, unknown, unknown>;
      },
    };
    const result = await redecideWith(run, {
      input: dune,
      registry: { ...registry, actions: new Map([...registry.actions, [action.ref, failing]]) },
    });
    expect(result.reproduced).toBe(false);
    expect(result.differences[0]).toMatch(/diverged from the record/);
  });

  test('another input than the recorded one is refused', async () => {
    const run = await started(libraryApp, 'library.addBook', { input: dune, principal: ada });
    await expect(redecideWith(run, { input: { ...dune, title: 'Other' } })).rejects.toMatchObject({
      kind: 'validation',
    });
  });

  test('a command id nothing was recorded for is not found', async () => {
    const run = await started(libraryApp, 'library.addBook', { input: dune, principal: ada });
    await expect(
      redecideWith(run, { input: dune, commandId: crypto.randomUUID() }),
    ).rejects.toMatchObject({ kind: 'not_found' });
  });

  test('another tenant has no record of the command', async () => {
    const run = await started(libraryApp, 'library.addBook', { input: dune, principal: ada });
    await expect(
      expectReproduces(run.runtime, { commandId: run.commandId, input: dune, tenant: 'globex' }),
    ).rejects.toMatchObject({ kind: 'not_found' });
  });
});

describe('readAsOfPosition', () => {
  test('rows appear as the positions pass, and an archived or changed row is as it was', async () => {
    const run = await started(conformanceApp, 'library.book.reserve', {
      input: { id: bookId, ifVersion: 1 },
      principal: ada,
      rows: {
        'library.book': [
          { id: bookId, ...dune, addedBy: 'ada' },
          { id: '00000000-0000-7000-8000-000000000002', title: 'Emma', isbn: 'e', addedBy: 'ada' },
        ],
      },
    });
    const { app } = run.runtime;
    const entry = app.registry.entities.get('library.book');
    if (entry === undefined) throw new Error('no book');
    const address = tenantAddress(run.runtime, run.tenant);
    const positions = run.events.map((event) => event.position);
    const at = (position: Position): Promise<readonly StorageRow[]> =>
      run.runtime.adapter.unit(address.namespace, address.scope, (unit) =>
        readAsOfPosition({
          unit,
          entry,
          behaviours: entityBehavioursOf(app.modules),
          at: position,
        }),
      );
    expect(positions).toEqual([1n, 2n, 3n]);
    expect(await at(0n)).toEqual([]);
    expect((await at(1n)).map((row) => row.title)).toEqual(['Dune']);
    expect((await at(2n)).map((row) => row.title)).toEqual(['Dune', 'Emma']);
    const before = (await at(2n)).find((row) => row.id === bookId);
    const after = (await at(3n)).find((row) => row.id === bookId);
    expect([before?.version, before?.reservedBy]).toEqual([1, undefined]);
    expect([after?.version, after?.reservedBy]).toEqual([2, 'ada']);
  });

  test('another tenant holds no rows of the entity', async () => {
    const run = await started(libraryApp, 'library.addBook', { input: dune, principal: ada });
    const { app } = run.runtime;
    const entry = app.registry.entities.get('library.book');
    if (entry === undefined) throw new Error('no book');
    const address = tenantAddress(run.runtime, 'globex');
    const rows = await run.runtime.adapter.unit(address.namespace, address.scope, (unit) =>
      readAsOfPosition({
        unit,
        entry,
        behaviours: entityBehavioursOf(app.modules),
        at: 1n,
      }),
    );
    expect(rows).toEqual([]);
  });
});
