import { defineCommand } from '../../../dsl/define-command.ts';
import { errors } from '../../../errors/errors.ts';
import { field } from '../../../fields/field.ts';
import { shape } from '../../../fields/shape.ts';
import { coreBase } from '../../base.ts';
import type { CoreLiteral } from '../../core-type.ts';
import { tenant } from '../../entities/tenant.ts';

/**
 * The `core.tenant.enter` command (section 8.8): the operator's explicit, logged entry into a
 * tenant. The reason becomes the tenant's `entered` event, which carries the operator, the instant
 * and the build like every event. A suspended tenant cannot be entered.
 */
export const enter: CoreLiteral['entityActions']['tenant']['enter'] = defineCommand(
  coreBase,
  tenant,
  {
    scope: 'deployment',
    principal: 'operator',
    input: shape({ reason: field.string({ minLength: 1, maxLength: 500 }) }),
    decide: (input, current, ctx) => {
      if (current.status !== 'active') throw errors.conflict('The tenant is suspended.');
      return { events: [ctx.events.entered({ reason: input.reason })] };
    },
  },
);
