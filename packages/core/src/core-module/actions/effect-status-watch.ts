import { defineSubscription } from '../../dsl/define-subscription.ts';
import { field } from '../../fields/field.ts';
import { shape } from '../../fields/shape.ts';
import { effectStatusSourceOf } from '../../live/effect-status-source-of.ts';
import { coreBase } from '../base.ts';
import type { CoreLiteral } from '../core-type.ts';
import { effectStatusShape } from '../shapes/effect-status-shape.ts';

/**
 * The `core.effectStatusWatch` subscription (7.9.5, 15.4.2): the current status of each listed
 * effect the caller requested, then `head`, then each change; served by the hub through the
 * kernel's status view.
 */
export const effectStatusWatch: CoreLiteral['actions']['effectStatusWatch'] = defineSubscription(
  coreBase,
  {
    scope: 'invocation',
    hints: { graphql: { enums: { status: 'CoreEffectStatus' } } },
    input: shape({ ids: field.list(field.ref.own('effect')) }),
    event: effectStatusShape,
    source: (input) => effectStatusSourceOf(input.ids),
  },
);
