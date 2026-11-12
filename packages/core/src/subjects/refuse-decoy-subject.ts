import type { Shape, ShapeFields } from '../fields/shape.ts';
import type { ShapeValue } from '../fields/shape-value.ts';
import type { StandardResult } from '../fields/standard-schema-v1.ts';
import { decoySubject } from '../keys/decoy-subject.ts';
import { canonicalSubject } from './canonical-subject.ts';

const refused = canonicalSubject(decoySubject);

/**
 * The same shape, whose own check also refuses the reserved decoy subject of a scope, in either
 * spelling, as a validation error that names the member. The decoy holds a real data key so that a
 * lookup of an absent API key does the work of a found one; a shredded decoy key would make an
 * unknown key cheaper than a found one for good, so an erasure input never names it. The check is
 * code, not a pattern of the member, so the member's pattern stays one every regular-expression
 * engine compiles and prints no internal constant into a surface, an OpenAPI document or a golden.
 */
export function refuseDecoySubject<F extends ShapeFields>(
  input: Shape<F>,
  member: keyof F & string,
): Shape<F> {
  const inner = input['~standard'];
  type Result = StandardResult<ShapeValue<F, string, 'value'>>;
  const check = (value: unknown, result: Result): Result => {
    const named =
      typeof value === 'object' && value !== null ? Reflect.get(value, member) : undefined;
    if (typeof named !== 'string' || canonicalSubject(named) !== refused) return result;
    const issue = { message: 'is reserved and names no subject', path: [member] };
    return { issues: [...(result.issues ?? []), issue] };
  };
  return {
    ...input,
    '~standard': {
      ...inner,
      validate: (value, options) => {
        const result = inner.validate(value, options);
        return result instanceof Promise
          ? result.then((settled) => check(value, settled))
          : check(value, result);
      },
    },
  };
}
