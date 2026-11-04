import { defineCommand, field, shape } from '@keelwerk/core';
import { connection } from '../github/connection.ts';
import { exchangeCode } from '../github/exchange-code.ts';
import { exchangeFailed } from '../github/exchange-failed.ts';
import { githubBase } from '../github/github-base.ts';
import { stateUnknown } from '../github/state-unknown.ts';

/**
 * GitHub's connection flow in the separate form: `prepare` checks that the state belongs to an
 * open start, and only then spends the code on the exchange. `decide` sees the outcome as
 * `ctx.prepared`, re-reads the start inside the unit and stores the connection.
 */
export const connectGithub = defineCommand(githubBase, {
  input: shape({ code: field.string(), state: field.string({ maxLength: 64 }) }),
  output: shape({ connectionId: field.ref.own('connection') }),
  errors: [stateUnknown, exchangeFailed],
  auth: { public: true },
  *prepare(input, ctx) {
    const open = yield* ctx.load.github.pendingConnect.one({ where: { state: input.state } });
    if (open === undefined || open.consumedAt !== undefined) {
      return { kind: 'refused' as const };
    }
    const exchange = yield* ctx.perform(exchangeCode({ code: input.code }));
    return { kind: 'exchanged' as const, exchange };
  },
  *decide(input, ctx) {
    const { prepared } = ctx;
    if (prepared.kind === 'refused') throw stateUnknown({ state: input.state });
    if (!prepared.exchange.ok) throw exchangeFailed({ reason: prepared.exchange.error.message });
    const open = yield* ctx.load.github.pendingConnect.one({ where: { state: input.state } });
    if (open === undefined || open.consumedAt !== undefined) {
      throw stateUnknown({ state: input.state });
    }
    const id = yield* ctx.newId(connection);
    const { accountLogin, token, scopes } = prepared.exchange.value;
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
