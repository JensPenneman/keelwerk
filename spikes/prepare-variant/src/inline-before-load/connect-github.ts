import { defineCommand, field, shape } from '@keelwerk/core';
import { connection } from '../github/connection.ts';
import { exchangeCode } from '../github/exchange-code.ts';
import { exchangeFailed } from '../github/exchange-failed.ts';
import { githubBase } from '../github/github-base.ts';
import { stateUnknown } from '../github/state-unknown.ts';
import { performs } from './performs.ts';

/**
 * GitHub's connection flow in the inline form: the exchange has to come first, because it is
 * only allowed before the first load. The state is therefore checked after the code is spent.
 */
export const connectGithub = defineCommand(githubBase, {
  input: shape({ code: field.string(), state: field.string({ maxLength: 64 }) }),
  output: shape({ connectionId: field.ref.own('connection') }),
  errors: [stateUnknown, exchangeFailed],
  auth: { public: true },
  *decide(input, ctx) {
    const exchange = yield* performs(ctx).perform(exchangeCode({ code: input.code }));
    if (!exchange.ok) throw exchangeFailed({ reason: exchange.error.message });
    const open = yield* ctx.load.github.pendingConnect.one({ where: { state: input.state } });
    if (open === undefined || open.consumedAt !== undefined) {
      throw stateUnknown({ state: input.state });
    }
    const id = yield* ctx.newId(connection);
    const { accountLogin, token, scopes } = exchange.value;
    return {
      events: [
        ctx.write.github.connection.create({
          id,
          accountLogin,
          tokenLast4: token.slice(-4),
          scopes,
          state: input.state,
        }),
        ctx.write.github.pendingConnect.consumed(open, { at: ctx.clock.now() }),
      ],
      result: { connectionId: id },
    };
  },
});
