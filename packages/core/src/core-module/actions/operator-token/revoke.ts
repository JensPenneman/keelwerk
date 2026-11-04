import { defineCommand } from '../../../dsl/define-command.ts';
import { errors } from '../../../errors/errors.ts';
import { coreBase } from '../../base.ts';
import type { CoreLiteral } from '../../core-type.ts';
import { operatorToken } from '../../entities/operator-token.ts';

/** The `core.operatorToken.revoke` command (S-26). */
export const revoke: CoreLiteral['entityActions']['operatorToken']['revoke'] = defineCommand(
  coreBase,
  operatorToken,
  {
    scope: 'deployment',
    principal: 'operator',
    decide: () => {
      throw errors.not_implemented('core.operatorToken.revoke is not available in this build.');
    },
  },
);
