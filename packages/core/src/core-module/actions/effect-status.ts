import { evaluateCondition } from '../../conditions/evaluate-condition.ts';
import { defineQuery } from '../../dsl/define-query.ts';
import { effectStatusOf } from '../../effects/effect-status-of.ts';
import { submitterCondition } from '../../effects/submitter-condition.ts';
import { errors } from '../../errors/errors.ts';
import { field } from '../../fields/field.ts';
import { shape } from '../../fields/shape.ts';
import { coreBase } from '../base.ts';
import type { CoreLiteral } from '../core-type.ts';
import { effectStatusShape } from '../shapes/effect-status-shape.ts';

/**
 * The `core.effectStatus` query (7.9.5): the status of one effect, for the principal whose command
 * requested it. Any other effect, of another principal, another scope, without a submitter or
 * unknown, is the same `errors.not_found('The effect is not found.')`. The core module owns the
 * hidden submitter columns, so its own load reads them; no rule names them.
 */
export const effectStatus: CoreLiteral['actions']['effectStatus'] = defineQuery(coreBase, {
  scope: 'invocation',
  hints: { graphql: { enums: { status: 'CoreEffectStatus' } } },
  input: shape({ id: field.ref.own('effect') }),
  output: effectStatusShape,
  *read(input, ctx) {
    const row = yield* ctx.load.core.effect.byId(input.id);
    if (row === undefined || !evaluateCondition(submitterCondition(ctx.principal), row)) {
      throw errors.not_found('The effect is not found.');
    }
    const status = effectStatusOf(row);
    if (status === undefined) throw errors.not_found('The effect is not found.');
    return status;
  },
});
