import { defineCommand } from '../../../dsl/define-command.ts';
import { errors } from '../../../errors/errors.ts';
import { field } from '../../../fields/field.ts';
import { shape } from '../../../fields/shape.ts';
import { coreBase } from '../../base.ts';
import type { CoreLiteral } from '../../core-type.ts';
import { tenant } from '../../entities/tenant.ts';

/** The `core.tenant.setApiVersion` command (S-26). */
export const setApiVersion: CoreLiteral['entityActions']['tenant']['setApiVersion'] = defineCommand(
  coreBase,
  tenant,
  {
    input: shape({ apiVersion: field.string() }),
    decide: () => {
      throw errors.not_implemented('core.tenant.setApiVersion is not available in this build.');
    },
  },
);
