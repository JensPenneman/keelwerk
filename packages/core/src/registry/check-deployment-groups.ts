import type { ComposableApp } from './composable-app.ts';
import { compositionError } from './composition-error.ts';
import type { CompositionProblem } from './composition-problem.ts';
import { probeContext } from './probe-context.ts';
import type { Registry } from './registry.ts';

function scopeOf(group: () => { readonly scope?: string }): string | undefined {
  try {
    return group().scope;
  } catch {
    // A group function that cannot run on a probe is outside what this check can see (S-123).
    return undefined;
  }
}

/** `deploymentGroupsUnavailable` (S-123): a job group with deployment scope waits for the deployment-wide job store. */
export function checkDeploymentGroups(
  _app: ComposableApp,
  registry: Registry,
): readonly CompositionProblem[] {
  const problems: CompositionProblem[] = [];
  for (const executor of registry.executors.values()) {
    const group = executor.group;
    if (group === undefined) continue;
    const scope = scopeOf(() =>
      group.call(executor, { config: probeContext(), input: probeContext() }),
    );
    if (scope === 'deployment') {
      problems.push(
        compositionError(
          'deploymentGroupsUnavailable',
          `The executor '${executor.ref}' names a group with deployment scope, which this release does not build.`,
          { module: executor.module, ref: executor.ref },
        ),
      );
    }
  }
  return problems;
}
