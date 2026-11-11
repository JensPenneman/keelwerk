import type { Shape } from '../fields/shape.ts';
import { canonicalizeJson } from '../json/canonicalize-json.ts';
import { plainJsonProblem } from './plain-json-problem.ts';

function sameJson(left: unknown, right: unknown): boolean {
  try {
    return canonicalizeJson(left) === canonicalizeJson(right);
  } catch {
    return false;
  }
}

/**
 * Why a value is not a value of a json flag, or `undefined`: its shape refuses it, or the shape
 * converts it. A json flag serves the stored value as it is, so the shape only judges: the value
 * must come out of the shape unchanged: plain JSON, deeply equal (a Temporal value or a class
 * instance with `toJSON` would serialise equal, yet differ from what a handler is typed to get).
 */
export function jsonFlagProblem(
  flag: { readonly schema?: Shape | undefined },
  value: unknown,
): string | undefined {
  if (flag.schema === undefined) return undefined;
  const result = flag.schema['~standard'].validate(value);
  if (result instanceof Promise) return 'The flag schema did not answer synchronously.';
  if (result.issues !== undefined) return result.issues.map((issue) => issue.message).join('; ');
  const problem = plainJsonProblem(result.value, 0, true);
  if (problem !== undefined) return `The shape's output ${problem}.`;
  return sameJson(result.value, value)
    ? undefined
    : "A json flag's shape may not convert values: the value must come out of the shape unchanged.";
}
