import { defineCommand } from '../../../dsl/define-command.ts';
import { coreBase } from '../../base.ts';
import type { CoreLiteral } from '../../core-type.ts';
import { operatorToken } from '../../entities/operator-token.ts';

/** The `core.operatorToken.revoke` command (section 3.5): the token stops authenticating at once; revoking twice changes nothing. */
export const revoke: CoreLiteral['entityActions']['operatorToken']['revoke'] = defineCommand(
  coreBase,
  operatorToken,
  {
    scope: 'deployment',
    principal: 'operator',
    decide: (_input, current, ctx) => ({
      events:
        current.revokedAt === undefined
          ? [ctx.write.core.operatorToken.update(current, { revokedAt: ctx.clock.now() })]
          : [],
    }),
  },
);
