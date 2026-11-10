import { expect, test } from 'vitest';
import { addBooks, runDirect, withCommand } from './support/command-kit.ts';
import { openPglite } from './support/pglite-kit.ts';

interface Ctx {
  readonly load: {
    readonly library: { readonly book: { byId(id: string): Generator<never, unknown, unknown> } };
  };
  readonly write: {
    readonly library: { readonly book: { update(target: unknown, patch: object): unknown } };
  };
  all(requests: readonly unknown[]): Generator<never, readonly unknown[], unknown>;
}

const idOf = (row: unknown): unknown => (row as { id?: unknown } | undefined)?.id;

test('an uppercase id in ctx.all answers as it does in a turn of its own on PGlite', async () => {
  const adapter = await openPglite();
  try {
    const ids = await addBooks(adapter, 2);
    const first = ids[0] as string;
    const second = ids[1] as string;
    const upper = first.toUpperCase();
    const answers = new Map<string, readonly unknown[]>();
    for (const name of ['together', 'inTurn'] as const) {
      const probe = withCommand(
        name,
        function* (_input: unknown, ctx: Ctx) {
          const members = [ctx.load.library.book.byId(upper), ctx.load.library.book.byId(second)];
          if (name === 'together') {
            answers.set(name, yield* ctx.all(members));
          } else {
            const each: unknown[] = [];
            for (const member of members) each.push(yield* member);
            answers.set(name, each);
          }
          return [ctx.write.library.book.update(first, { title: name })];
        } as never,
        'library.addBook',
      );
      await runDirect({
        registry: probe.registry,
        adapter,
        action: probe.ref,
        input: {},
        commandId: name,
      });
    }
    const batched = (answers.get('together') ?? []).map(idOf);
    expect(batched).toEqual([first, second]);
    expect((answers.get('inTurn') ?? []).map(idOf)).toEqual(batched);
  } finally {
    await adapter.close(1000);
  }
}, 60_000);
