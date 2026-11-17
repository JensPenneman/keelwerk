import type { Condition } from '../conditions/condition.ts';
import { evaluateCondition } from '../conditions/evaluate-condition.ts';
import type { EffectEntry } from '../registry/effect-entry.ts';
import { decodeShapeValue } from '../write-path/decode-shape-value.ts';
import { holdsSealedValue } from './holds-sealed-value.ts';

/**
 * The plain members of an effect's stored input (only names in `plain`, never a value that holds a
 * sealed value), decoded to domain values, when `where` holds over them (always without one).
 * Undefined when it does not hold, when a stored value cannot be decoded, when a `where` is given
 * and a plain member was left out because it holds a sealed value, or when the condition cannot be
 * answered. The one evaluator of the pending-effects stream and of a settle's `where`.
 */
export function matchingPlainInput(
  entry: Pick<EffectEntry, 'input' | 'module'>,
  plain: ReadonlySet<string>,
  where: Condition | undefined,
  stored: unknown,
): Readonly<Record<string, unknown>> | undefined {
  const picked: Record<string, unknown> = {};
  let withheld = false;
  if (typeof stored === 'object' && stored !== null) {
    for (const name of plain) {
      if (!Object.hasOwn(stored, name)) continue;
      const value: unknown = Reflect.get(stored, name);
      // A value that holds a sealed value is left out, whatever the member's flags were when it was stored.
      if (holdsSealedValue(value)) withheld = true;
      else picked[name] = value;
    }
  }
  let input: Readonly<Record<string, unknown>>;
  try {
    input = decodeShapeValue(entry.input, entry.module, picked) as Readonly<
      Record<string, unknown>
    >;
  } catch {
    // A stored value its field cannot read matches nothing, like a condition the input cannot answer.
    return undefined;
  }
  if (where === undefined) return input;
  // A member that was left out reads as absent, and a negative condition would hold over it: an
  // input that is not whole matches no condition.
  if (withheld) return undefined;
  try {
    return evaluateCondition(where, input) ? input : undefined;
  } catch {
    // A condition the input cannot answer matches nothing.
    return undefined;
  }
}
