import { defineCommand, errors, field, shape } from '@keelwerk/core';
import { passesBase } from '../base.ts';

/** Revokes a pass: its bearer, and every stream it opened, stop being accepted. */
const revokeDef = defineCommand(passesBase, {
  input: shape({ id: field.ref.own('pass') }),
  output: shape({}),
  principal: 'user',
  execution: 'sync',
  *decide(input, ctx) {
    const found = yield* ctx.load.passes.pass.byId(input.id);
    if (found === undefined) throw errors.not_found('There is no such pass.');
    return {
      events: [ctx.write.passes.pass.update(found, { revokedAt: ctx.clock.now() })],
      result: {},
    };
  },
});

type RevokePart = typeof revokeDef;
/** The action's type, named once so the rules and the manifest do not repeat it. */
export interface Revoke extends RevokePart {}
export const revoke: Revoke = revokeDef;
