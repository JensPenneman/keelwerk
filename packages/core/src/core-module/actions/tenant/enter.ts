import { defineCommand } from '../../../dsl/define-command.ts';
import { errors } from '../../../errors/errors.ts';
import { field } from '../../../fields/field.ts';
import { shape } from '../../../fields/shape.ts';
import { coreBase } from '../../base.ts';
import type { CoreLiteral } from '../../core-type.ts';
import { tenant } from '../../entities/tenant.ts';

/** The `core.tenant.enter` command (S-26). */
export const enter: CoreLiteral['entityActions']['tenant']['enter'] = defineCommand(
  coreBase,
  tenant,
  {
    scope: 'deployment',
    principal: 'operator',
    input: shape({ reason: field.string() }),
    decide: () => {
      throw errors.not_implemented('core.tenant.enter is not available in this build.');
    },
  },
);
