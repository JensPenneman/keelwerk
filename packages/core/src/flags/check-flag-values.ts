import { errors } from '../errors/errors.ts';
import type { FlagSpec } from './flag-spec.ts';
import type { FlagServe, FlagVariant } from './flag-targeting.ts';
import { isFlagValue } from './is-flag-value.ts';
import { jsonFlagProblem } from './json-flag-problem.ts';
import { variantOf } from './variant-of.ts';

function refuse(path: string, message: string): never {
  throw errors.validation(`${path}: ${message}`);
}

function checkValue(flag: FlagSpec, served: FlagVariant, path: string): void {
  const { value } = served;
  if (!isFlagValue(flag, value)) {
    refuse(
      `${path}.value`,
      flag.kind === 'variant'
        ? `${JSON.stringify(value)} is not a declared variant of "${flag.key}" (${(flag.variants ?? []).join(', ')}).`
        : `The value is not a ${flag.kind} as "${flag.key}" declares.`,
    );
  }
  if (flag.kind === 'number' && typeof value === 'number') {
    if (flag.min !== undefined && value < flag.min)
      refuse(`${path}.value`, `The value is below the minimum ${flag.min}.`);
    if (flag.max !== undefined && value > flag.max)
      refuse(`${path}.value`, `The value is above the maximum ${flag.max}.`);
  }
  if (flag.kind === 'json') {
    const problem = jsonFlagProblem(flag, value);
    if (problem !== undefined) refuse(`${path}.value`, problem);
  } else if (served.variant !== undefined && served.variant !== String(value)) {
    refuse(
      `${path}.variant`,
      `The variant of a ${flag.kind} value is ${JSON.stringify(String(value))}.`,
    );
  }
}

/** The position a share must take: declared order for a variant flag, true before false for a boolean. */
function orderOf(flag: FlagSpec, served: FlagVariant): number {
  if (flag.kind === 'variant') return (flag.variants ?? []).indexOf(String(served.value));
  return served.value === true ? 0 : 1;
}

function checkServe(flag: FlagSpec, serve: FlagServe, path: string): void {
  if (!('split' in serve)) {
    checkValue(flag, serve, path);
    return;
  }
  if (flag.level === 'deployment') {
    refuse(
      `${path}.split`,
      `"${flag.key}" is a deployment-level flag: it has no targeting key to split.`,
    );
  }
  let previous = -1;
  serve.split.forEach((share, index) => {
    const where = `${path}.split[${index}]`;
    checkValue(flag, share, where);
    if (flag.kind === 'variant' || flag.kind === 'boolean') {
      const position = orderOf(flag, share);
      if (position <= previous) {
        refuse(
          where,
          flag.kind === 'variant'
            ? 'Shares follow the declared order of the variants.'
            : 'A boolean split lists true before false.',
        );
      }
      previous = position;
    }
  });
  const names = serve.split.map(variantOf);
  if (new Set(names).size !== names.length) refuse(`${path}.split`, 'A variant is listed twice.');
}

/**
 * Checks targeting against the flag's declaration (the write's second half, and the cache's check
 * at load): every served value is of the flag's kind, within its bounds and its schema; for every
 * kind but json a given variant is String(value); a variant flag's shares follow the declared
 * order; a boolean split lists true before false; no split on a deployment-level flag (it has no
 * targeting key). Throws `validation` naming the first problem's path.
 */
export function checkFlagValues(
  flag: FlagSpec,
  targeting: {
    readonly rules: readonly { readonly serve: FlagServe }[];
    readonly fallthrough: FlagServe;
  },
): void {
  for (const [index, rule] of targeting.rules.entries()) {
    checkServe(flag, rule.serve, `rules[${index}].serve`);
  }
  checkServe(flag, targeting.fallthrough, 'fallthrough');
}
