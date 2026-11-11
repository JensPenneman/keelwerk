import { flagSpecsOf } from '../flags/flag-specs-of.ts';
import { jsonFlagProblem } from '../flags/json-flag-problem.ts';
import type { ComposableApp } from './composable-app.ts';
import { compositionError } from './composition-error.ts';
import type { CompositionProblem } from './composition-problem.ts';
import type { Registry } from './registry.ts';

/**
 * `jsonFlagDefaultInvalid`: the declared default of a json flag must pass the flag's shape and
 * come out of it unchanged, because the default is served as it is, like any stored value.
 */
export function checkJsonFlagDefaults(
  _app: ComposableApp,
  registry: Registry,
): readonly CompositionProblem[] {
  const problems: CompositionProblem[] = [];
  for (const [key, flag] of flagSpecsOf(registry)) {
    if (flag.kind !== 'json') continue;
    const problem = jsonFlagProblem(flag, flag.default);
    if (problem === undefined) continue;
    problems.push(
      compositionError(
        'jsonFlagDefaultInvalid',
        `The default of the json flag '${key}' is refused: ${problem}`,
        { module: key.slice(0, key.indexOf('.')), ref: key },
      ),
    );
  }
  return problems;
}
