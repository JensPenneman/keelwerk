import { defineCommand, field, shape } from '@keelwerk/core';
import { exchangeCode } from '../github/exchange-code.ts';
import { githubBase } from '../github/github-base.ts';
import { stateUnknown } from '../github/state-unknown.ts';
import { performs } from './performs.ts';

/**
 * A probe that does what the separate form allows and the variant forbids: it loads the start
 * first and performs the exchange after that load.
 */
export const connectLate = defineCommand(githubBase, {
  input: shape({ code: field.string(), state: field.string({ maxLength: 64 }) }),
  errors: [stateUnknown],
  auth: { public: true },
  *decide(input, ctx) {
    const open = yield* ctx.load.github.pendingConnect.one({ where: { state: input.state } });
    if (open === undefined) throw stateUnknown({ state: input.state });
    yield* performs(ctx).perform(exchangeCode({ code: input.code }));
    return [];
  },
});
