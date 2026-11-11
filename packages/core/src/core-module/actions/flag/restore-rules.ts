import { defineCommand } from '../../../dsl/define-command.ts';
import { errors } from '../../../errors/errors.ts';
import { field } from '../../../fields/field.ts';
import { shape } from '../../../fields/shape.ts';
import { coreBase } from '../../base.ts';
import type { CoreLiteral } from '../../core-type.ts';
import { flag } from '../../entities/flag.ts';

/**
 * The `core.flag.restoreRules` command (20.4): goes back one step by swapping `targeting` and
 * `previous`, so a second call goes forward again. A flag never changed has nothing to restore.
 * It names the row version it restores from (`ifVersion`); another version is a conflict.
 */
export const restoreRules: CoreLiteral['entityActions']['flag']['restoreRules'] = defineCommand(
  coreBase,
  flag,
  {
    scope: 'deployment',
    principal: 'operator',
    // `ifVersion` is required: the operator restores the rule set they saw, and a change that
    // came in between is a conflict they retry, never a retry that restores something else.
    input: shape({
      reason: field.string({ minLength: 1, maxLength: 500 }),
      ifVersion: field.integer(),
    }),
    decide: (input, current, ctx) => {
      if (current.previous === undefined) {
        throw errors.conflict('The flag has no earlier rule set.');
      }
      return {
        events: [
          ctx.write.core.flag.update(current, {
            targeting: current.previous,
            previous: current.targeting,
            reason: input.reason,
          }),
        ],
      };
    },
  },
);
