import { defineCommand, errors, field, shape } from '@keelwerk/core';
import { passesBase } from '../base.ts';

/** Changes a pass without revoking it: the pass stays valid, and every stream it opened is revalidated. */
const labelDef = defineCommand(passesBase, {
  input: shape({ id: field.ref.own('pass'), label: field.string({ maxLength: 100 }) }),
  output: shape({}),
  principal: 'user',
  execution: 'sync',
  *decide(input, ctx) {
    const found = yield* ctx.load.passes.pass.byId(input.id);
    if (found === undefined) throw errors.not_found('There is no such pass.');
    return { events: [ctx.write.passes.pass.update(found, { label: input.label })], result: {} };
  },
});

type LabelPart = typeof labelDef;
/** The action's type, named once so the rules and the manifest do not repeat it. */
export interface Label extends LabelPart {}
export const label: Label = labelDef;
