import { describe, expect, test } from 'vitest';
import { commandKit, flaky, runDirect, snapshot, withCommand } from './support/command-kit.ts';

interface Prepared {
  readonly prepared: { readonly title: string };
  readonly write: {
    readonly library: {
      readonly book: { create(values: Record<string, unknown>): unknown };
    };
  };
}

describe('prepare (S-05)', () => {
  test('runs once outside the unit and its value reaches decide as ctx.prepared, also across retries', async () => {
    let prepares = 0;
    const probe = withCommand(
      'prepared',
      (_input: unknown, ctx: Prepared) => [
        ctx.write.library.book.create({ title: ctx.prepared.title, isbn: 'p-1', addedBy: 'ada' }),
      ],
      'library.addBook',
      {
        prepare: () => {
          prepares += 1;
          return { title: 'From prepare' };
        },
      },
    );
    const { adapter } = flaky(commandKit().adapter, 1);
    await runDirect({ registry: probe.registry, adapter, action: probe.ref, input: {} });
    expect(prepares).toBe(1);
    expect((await snapshot(adapter)).books[0]?.title).toBe('From prepare');
  });

  test('a perform request fails with core.request_not_allowed and nothing is stored', async () => {
    const probe = withCommand('performs', () => [], 'library.addBook', {
      prepare: (_input: unknown, ctx: { perform(effect: unknown): object }) =>
        ctx.perform({ kind: 'external', type: 'hooks.post' }),
    });
    const { adapter } = commandKit();
    const error = await runDirect({
      registry: probe.registry,
      adapter,
      action: probe.ref,
      input: {},
      commandId: 'p1',
    }).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ kind: 'internal', code: 'core.request_not_allowed' });
    expect((await snapshot(adapter, undefined, 'p1')).receipt).toBeUndefined();
  });
});

describe('the deadline', () => {
  test('an aborted signal rolls the unit back and rejects with its reason', async () => {
    const controller = new AbortController();
    const probe = withCommand(
      'slowPoke',
      (_input: unknown, ctx: Prepared) => {
        controller.abort(new Error('timed out'));
        return [ctx.write.library.book.create({ title: 't', isbn: 'x', addedBy: 'ada' })];
      },
      'library.addBook',
    );
    const { adapter } = commandKit();
    const error = await runDirect({
      registry: probe.registry,
      adapter,
      action: probe.ref,
      input: {},
      commandId: 's1',
      signal: controller.signal,
    }).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ message: 'timed out' });
    const { books, receipt } = await snapshot(adapter, undefined, 's1');
    expect(books).toHaveLength(0);
    expect(receipt).toBeUndefined();
  });
});
