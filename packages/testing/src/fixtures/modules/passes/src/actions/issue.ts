import { defineCommand, field, shape } from '@keelwerk/core';
import { passesBase } from '../base.ts';
import { pass } from '../entities/pass.ts';

/**
 * A test credential for the live slices: the bearer token is `pass.<id>`, the id of the row. It is
 * no secret and no way to sign in; a real credential keeps only a verifier.
 */
const issueDef = defineCommand(passesBase, {
  input: shape({ holder: field.string({ maxLength: 100 }) }),
  output: shape({ id: field.ref.own('pass'), token: field.string() }),
  shownOnce: ['token'],
  principal: 'user',
  execution: 'sync',
  *decide(input, ctx) {
    const id = yield* ctx.newId(pass);
    return {
      events: [ctx.write.passes.pass.create({ id, holder: input.holder })],
      result: { id, token: `pass.${id}` },
    };
  },
});

type IssuePart = typeof issueDef;
/** The action's type, named once so the rules and the manifest do not repeat it. */
export interface Issue extends IssuePart {}
export const issue: Issue = issueDef;
