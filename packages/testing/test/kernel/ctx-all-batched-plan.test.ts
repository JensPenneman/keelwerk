import { normalizeRule } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import {
  bookRow,
  counting,
  type ProbeContext,
  runnable,
  uuid,
  withQuery,
} from './support/run-read-kit.ts';

describe('the caller plan on a batch', () => {
  test('a member outside the caller plan still answers absent', async () => {
    const probe = withQuery('plan', function* (_input: unknown, ctx: ProbeContext) {
      const loads = ctx.load.library.book.forCaller();
      return yield* ctx.all([loads.byId(uuid(1)), loads.byId(uuid(2)), loads.byId(uuid(3))]);
    });
    const { adapter, seed, run } = runnable({ registry: probe.registry, action: probe.ref });
    await seed([bookRow(1), bookRow(2, { addedBy: 'bob' }), bookRow(3, { addedBy: 'bob' })]);
    const readers = probe.registry.rules.get('library.book.readers');
    if (readers === undefined) throw new Error('the library fixture has no readers rule');
    const ownOnly = normalizeRule({
      ...readers,
      id: 'library.book.own',
      where: (context: unknown) => ({
        addedBy: (context as { principal: { subject: string } }).principal.subject,
      }),
    });
    const result = await run({
      adapter: counting(adapter),
      rules: [ownOnly],
      concurrentUnits: true,
    });
    const answers = result.output as readonly ({ title: string } | undefined)[];
    expect(answers.map((row) => row?.title)).toEqual(['Book 1', undefined, undefined]);
    expect(result.reads).toEqual([{ at: 1n }, { at: 1n }, { at: 1n }]);
  });
});
