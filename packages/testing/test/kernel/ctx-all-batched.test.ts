import type { ActionEntry, DataAdapter, Registry } from '@keelwerk/core';
import { createComputePool, normalizeRule } from '@keelwerk/core';
import { redecide } from '@keelwerk/core/replay';
import { describe, expect, test } from 'vitest';
import {
  addBooks,
  behaviours,
  bookEntity,
  loanEntity,
  runDirect,
  snapshot,
  withCommand,
} from './support/command-kit.ts';
import { findsOf } from './support/finds-of.ts';
import { openPglite } from './support/pglite-kit.ts';
import { clock, namespace, open, silent, tenant } from './support/run-read-kit.ts';

interface AllContext {
  readonly load: {
    readonly library: { readonly book: { byId(id: string): Generator<never, unknown, unknown> } };
    readonly loans: { readonly loan: { byId(id: string): Generator<never, unknown, unknown> } };
  };
  readonly write: {
    readonly library: {
      readonly book: { update(target: unknown, patch: Record<string, unknown>): unknown };
    };
    readonly loans: {
      readonly loan: { update(target: unknown, patch: Record<string, unknown>): unknown };
    };
  };
  all(requests: readonly unknown[]): Generator<never, readonly unknown[], unknown>;
}

const reservedOf = (ref: string): ActionEntry => {
  const entry = withCommand('probe', () => undefined, ref).registry.actions.get(ref);
  if (entry === undefined) throw new Error(`no ${ref}`);
  return entry;
};

interface Probes {
  readonly together: ReturnType<typeof withCommand>;
  readonly inTurn: ReturnType<typeof withCommand>;
  ids: readonly string[];
}

function probes(): Probes {
  const state: Probes = {
    ids: [],
    together: undefined as never,
    inTurn: undefined as never,
  };
  const together = function* (_input: unknown, ctx: AllContext) {
    yield* ctx.all(state.ids.map((id) => ctx.load.library.book.byId(id)));
    return [ctx.write.library.book.update(state.ids[0], { title: 'Tallied' })];
  };
  const inTurn = function* (_input: unknown, ctx: AllContext) {
    for (const id of state.ids) yield* ctx.load.library.book.byId(id);
    return [ctx.write.library.book.update(state.ids[0], { title: 'Tallied' })];
  };
  return Object.assign(state, {
    together: withCommand('together', together as never, 'library.addBook'),
    inTurn: withCommand('inTurn', inTurn as never, 'library.addBook'),
  });
}

async function redecided(adapter: DataAdapter, registry: Registry, commandId: string) {
  const compute = createComputePool({ size: 1 });
  try {
    return await redecide({
      registry,
      adapter,
      namespace,
      scope: tenant,
      commandId,
      input: {},
      apiVersion: '2026-11-04',
      behaviours,
      rules: [...registry.rules.values()]
        .filter((rule) => rule.disabled !== true)
        .map(normalizeRule),
      keys: {} as never,
      compute,
      clock,
      log: silent,
      trace: {} as never,
    });
  } finally {
    await compute.close();
  }
}

const decisionOf = async (adapter: DataAdapter, bookId: string) =>
  (await snapshot(adapter, bookId)).events.at(-1)?.decision;

describe.each(['memory', 'pglite'] as const)('batched ctx.all on %s', (kind) => {
  async function withAdapter(body: (adapter: DataAdapter) => Promise<void>): Promise<void> {
    if (kind === 'memory') return body(open([bookEntity, loanEntity]));
    const adapter = await openPglite();
    try {
      await body(adapter);
    } finally {
      await adapter.close(1000);
    }
  }

  test(`five byId loads of one entity send one positioned find on ${kind}`, async () => {
    for (const [name, expected] of [
      ['together', 1],
      ['inTurn', 5],
    ] as const) {
      await withAdapter(async (base) => {
        const probe = probes();
        const counted = findsOf(base);
        probe.ids = await addBooks(base, 5);
        await runDirect({
          registry: probe[name].registry,
          adapter: counted.adapter,
          action: probe[name].ref,
          input: {},
          commandId: 'c1',
        });
        expect(counted.count('library.book')).toBe(expected);
      });
    }
  }, 60_000);

  test(`the record holds five reads at one position, equal to the member-by-member form's on ${kind}`, async () => {
    const reads = new Map<string, unknown>();
    for (const name of ['together', 'inTurn'] as const) {
      await withAdapter(async (adapter) => {
        const probe = probes();
        probe.ids = await addBooks(adapter, 5);
        await runDirect({
          registry: probe[name].registry,
          adapter,
          action: probe[name].ref,
          input: {},
          commandId: 'c1',
        });
        reads.set(name, (await decisionOf(adapter, probe.ids[0] as string))?.reads);
      });
    }
    const batched = reads.get('together') as readonly { readonly at: bigint }[];
    expect(batched).toEqual(reads.get('inTurn'));
    expect(new Set(batched.slice(0, 5).map((read) => String(read.at))).size).toBe(1);
  }, 60_000);

  test(`an existing record written member by member re-decides under the batched handler on ${kind}`, async () => {
    await withAdapter(async (adapter) => {
      const probe = probes();
      probe.ids = await addBooks(adapter, 5);
      await runDirect({
        registry: probe.inTurn.registry,
        adapter,
        action: probe.inTurn.ref,
        input: {},
        commandId: 'm1',
      });
      const entry = probe.inTurn.registry.actions.get(probe.inTurn.ref) as ActionEntry;
      const handler = probe.together.registry.actions.get(probe.together.ref)?.handler;
      const registry: Registry = {
        ...probe.inTurn.registry,
        actions: new Map([
          ...probe.inTurn.registry.actions,
          [probe.inTurn.ref, { ...entry, handler: handler as ActionEntry['handler'] }],
        ]),
      };
      const result = await redecided(adapter, registry, 'm1');
      expect(result.reproduced).toBe(true);
      expect(result.differences).toEqual([]);
    });
  }, 60_000);

  test(`a batched record re-decides on ${kind}`, async () => {
    await withAdapter(async (adapter) => {
      const probe = probes();
      probe.ids = await addBooks(adapter, 5);
      await runDirect({
        registry: probe.together.registry,
        adapter,
        action: probe.together.ref,
        input: {},
        commandId: 'b1',
      });
      const counted = findsOf(adapter);
      const result = await redecided(counted.adapter, probe.together.registry, 'b1');
      expect(result.reproduced).toBe(true);
      expect(result.differences).toEqual([]);
      // Five members and the target read, one fold each: member by member, as in decide.
      expect(counted.asOfReads('library.book')).toBe(6);
    });
  }, 60_000);

  test(`mixed entities fall back to one find each on ${kind}`, async () => {
    await withAdapter(async (base) => {
      const ids = await addBooks(base, 3);
      const lent = await runDirect({
        adapter: base,
        action: 'loans.lend',
        input: { bookTitle: 'x', dueAt: clock.now() },
      });
      const loanId = (lent.output as { loanId: string }).loanId;
      const probe = withCommand(
        'mixed',
        function* (_input: unknown, ctx: AllContext) {
          yield* ctx.all([
            ...ids.map((id) => ctx.load.library.book.byId(id)),
            ctx.load.loans.loan.byId(loanId),
          ]);
          return [ctx.write.loans.loan.update(loanId, { note: 'Tallied' })];
        } as never,
        'loans.lend',
      );
      const counted = findsOf(base);
      await runDirect({
        registry: probe.registry,
        adapter: counted.adapter,
        action: probe.ref,
        input: {},
        commandId: 'x1',
      });
      expect(counted.count('library.book')).toBe(1);
      expect(counted.count('loans.loan')).toBe(1);
      const events = await base.unit(namespace, tenant, (unit) =>
        unit.events.readStream({ type: 'loans.loan', id: loanId }),
      );
      const reads = events.at(-1)?.decision?.reads ?? [];
      expect(reads.slice(0, 4)).toHaveLength(4);
      expect(reads.slice(0, 3)).toEqual([reads[0], reads[0], reads[0]]);
    });
  }, 60_000);

  test(`a locked target is never batched on ${kind}`, async () => {
    await withAdapter(async (base) => {
      const ids = await addBooks(base, 5);
      const base_ = withCommand('probe', () => undefined, 'library.book.reserve').registry;
      const source = reservedOf('library.book.reserve');
      const handler = function* (_input: unknown, current: unknown, ctx: AllContext) {
        yield* ctx.all(ids.map((id) => ctx.load.library.book.byId(id)));
        return [ctx.write.library.book.update(current, { reservedBy: 'alice' })];
      };
      const probe = {
        ref: 'library.book.reserve',
        registry: {
          ...base_,
          actions: new Map([
            ...base_.actions,
            ['library.book.reserve', { ...source, handler: handler as never }],
          ]),
        } as Registry,
      };
      const counted = findsOf(base);
      await runDirect({
        registry: probe.registry,
        adapter: counted.adapter,
        action: probe.ref,
        input: { id: ids[0], ifVersion: 1 },
        commandId: 'k1',
      });
      expect(counted.count('library.book', true)).toBe(1);
      expect(counted.count('library.book')).toBe(1);
      const reads = (await decisionOf(base, ids[0] as string))?.reads ?? [];
      // One read for the locked target, then one per batched member: the target read is first.
      expect(reads).toHaveLength(6);
      expect(new Set(reads.slice(1, 6).map((read) => String(read.at))).size).toBe(1);
    });
  }, 60_000);
});
