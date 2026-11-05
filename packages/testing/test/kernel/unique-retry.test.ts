import { KeelwerkError, uniqueConflict } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import { commandKit, runDirect, withCommand } from './support/command-kit.ts';

const taken = () =>
  new KeelwerkError({ kind: 'conflict', code: 'library.taken', message: 'taken' });

/** An adapter whose first `failures` units run their work and then fail with a unique violation. */
function failingFirst(failures: number) {
  const { adapter } = commandKit();
  const state = { units: 0 };
  const wrapped = {
    ...adapter,
    unit: ((ns, scope, fn, options) => {
      state.units += 1;
      if (state.units > failures) return adapter.unit(ns, scope, fn, options);
      return adapter.unit(
        ns,
        scope,
        async (unit) => {
          await fn(unit);
          throw uniqueConflict('book_isbn_key', new Error('duplicate key'));
        },
        options,
      );
    }) as typeof adapter.unit,
  };
  return { adapter: wrapped, state };
}

function probe(decided: { count: number }) {
  return withCommand(
    'uniqueProbe',
    // biome-ignore lint/correctness/useYield: a handler that loads nothing
    function* () {
      decided.count += 1;
      // The first run sees no row; the repeat finds the committed one and answers the declared error.
      if (decided.count >= 2) throw taken();
      return {};
    },
    'library.addBook',
    { errors: ['library.taken'] },
  );
}

describe('a unique violation inside a command unit', () => {
  test('repeats the unit once so decide answers the declared error', async () => {
    const decided = { count: 0 };
    const command = probe(decided);
    const { adapter, state } = failingFirst(1);
    const error = await runDirect({
      registry: command.registry,
      adapter,
      action: command.ref,
      input: {},
    }).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: 'library.taken' });
    expect(decided.count).toBe(2);
    expect(state.units).toBe(2);
  });

  test('answers conflict when the repeat violates again, after two attempts in total', async () => {
    const decided = { count: 0 };
    const command = withCommand(
      'uniqueTwice',
      // biome-ignore lint/correctness/useYield: a handler that loads nothing
      function* () {
        decided.count += 1;
        return {};
      },
      'library.addBook',
    );
    const { adapter, state } = failingFirst(5);
    const error = await runDirect({
      registry: command.registry,
      adapter,
      action: command.ref,
      input: {},
    }).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ kind: 'conflict', code: 'core.conflict' });
    expect(decided.count).toBe(2);
    expect(state.units).toBe(2);
  });
});
