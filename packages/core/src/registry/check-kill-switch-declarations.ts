import { flagSpecsOf } from '../flags/flag-specs-of.ts';
import type { ComposableApp } from './composable-app.ts';
import { compositionError } from './composition-error.ts';
import type { CompositionProblem } from './composition-problem.ts';
import type { Registry } from './registry.ts';

/**
 * `killSwitchInvalid`: a kill switch is an operator's stop, so it is boolean and of level
 * deployment, backend or tenant. A principal-level flag is keyed by its caller, who can be
 * anonymous and then chooses the key or leaves it out; no key may decide a kill switch.
 */
export function checkKillSwitchDeclarations(
  _app: ComposableApp,
  registry: Registry,
): readonly CompositionProblem[] {
  const problems: CompositionProblem[] = [];
  for (const [key, flag] of flagSpecsOf(registry)) {
    if (flag.purpose !== 'kill-switch') continue;
    if (flag.kind === 'boolean' && flag.level !== 'principal') continue;
    problems.push(
      compositionError(
        'killSwitchInvalid',
        `The kill switch '${key}' is a ${flag.kind} flag of level '${flag.level}': a kill switch is boolean and of level deployment, backend or tenant.`,
        { module: key.slice(0, key.indexOf('.')), ref: key },
      ),
    );
  }
  return problems;
}
