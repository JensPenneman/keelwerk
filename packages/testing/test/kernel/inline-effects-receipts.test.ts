import { field, shape } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import { bootPair, draftOf, namedPrincipal, type PairContext } from './support/inline-pair-kit.ts';

const mismatch = { code: 'core.idempotency_mismatch' };
const ada = namedPrincipal('ada');

describe('the receipt of a command id is compared before an inline effect answers or starts', () => {
  test('a later effect that only a changed command member reaches is refused, and its executor never runs', async () => {
    const pair = bootPair({
      prepare: function* (input: Readonly<Record<string, unknown>>, ctx: PairContext) {
        yield* ctx.perform(draftOf('ping', { to: 'fixed' }));
        if (input.dest === 'x') return 'done';
        return yield* ctx.perform(draftOf('pong', { to: String(input.dest) }));
      },
    });
    await pair.run('c-receipt-1', { dest: 'x' }, { principal: ada });
    expect(pair.pings).toHaveLength(1);
    const error = await pair
      .run('c-receipt-1', { dest: 'y' }, { principal: ada })
      .catch((caught: unknown) => caught);
    expect(error).toMatchObject(mismatch);
    expect(pair.pings).toHaveLength(1);
    expect(pair.pongs).toHaveLength(0);
  });

  test('a finished command refuses an effect its first run did not perform, whatever a secret member says', async () => {
    const pair = bootPair({
      prepare: function* (input: Readonly<Record<string, unknown>>, ctx: PairContext) {
        yield* ctx.perform(draftOf('ping', { to: 'fixed' }));
        if (input.key === 'k1') return 'done';
        return yield* ctx.perform(draftOf('pong', { to: 'dest', key: input.key }));
      },
      pong: { input: shape({ to: field.string(), key: field.secret() }) },
    });
    await pair.run('c-receipt-2', { key: 'k1' }, { principal: ada });
    expect(pair.pings).toHaveLength(1);
    const error = await pair
      .run('c-receipt-2', { key: 'k2' }, { principal: ada })
      .catch((caught: unknown) => caught);
    expect(error).toMatchObject(mismatch);
    expect(pair.pings).toHaveLength(1);
    expect(pair.pongs).toHaveLength(0);
  });
});
