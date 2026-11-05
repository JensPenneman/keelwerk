import { defineCommand } from '../../../dsl/define-command.ts';
import { errors } from '../../../errors/errors.ts';
import { field } from '../../../fields/field.ts';
import { shape } from '../../../fields/shape.ts';
import { coreBase } from '../../base.ts';
import type { CoreLiteral } from '../../core-type.ts';
import { tenant } from '../../entities/tenant.ts';

const dateFormat = /^\d{4}-\d{2}-\d{2}$/;

function isCalendarDate(text: string): boolean {
  if (!dateFormat.test(text)) return false;
  try {
    return Temporal.PlainDate.from(text, { overflow: 'reject' }).toString() === text;
  } catch (error) {
    if (error instanceof RangeError) return false;
    throw error;
  }
}

/**
 * The `core.tenant.setApiVersion` command (section 18.3): pins the tenant to a dated API version.
 * The date must be a calendar date; whether the app serves it is decided when a request resolves
 * its version (a retired or unknown pin fails that request, S-78).
 */
export const setApiVersion: CoreLiteral['entityActions']['tenant']['setApiVersion'] = defineCommand(
  coreBase,
  tenant,
  {
    input: shape({ apiVersion: field.string() }),
    decide: (input, current, ctx) => {
      if (!isCalendarDate(input.apiVersion)) {
        throw errors.validation(
          `"${input.apiVersion}" is not an API version of the form YYYY-MM-DD.`,
        );
      }
      return {
        events:
          current.apiVersion === input.apiVersion
            ? []
            : [ctx.write.core.tenant.update(current, { apiVersion: input.apiVersion })],
      };
    },
  },
);
